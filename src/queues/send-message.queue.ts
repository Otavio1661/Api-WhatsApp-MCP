// src/queues/send-message.queue.ts
// Fila de envio assíncrono de mensagens — dividida em N "raias" (ver
// config.sending.queueLanes) pra um número com muita mensagem não atrasar
// outro número quase parado (achado real, teste de carga 2026-08-18: mesmo
// com concorrência alta, fila única ainda deixava isso acontecer por causa
// da ordem de chegada FIFO). BullMQ open source não tem "grupos" nativos de
// job (é feature paga do BullMQ Pro) — sharding manual por fila é o
// equivalente aberto (mesmo princípio de partição do Kafka / message group
// do SQS FIFO).
//
// Cada instância cai SEMPRE na mesma raia (hash do id) — mensagem sem
// instância (fallback de conta) particiona por apiClientId. As funções
// públicas (enqueueSend/removeSendJob/requeueSend) mantêm a MESMA
// assinatura de antes — resolvem a raia por dentro, então os 8 pontos que
// já chamam elas no resto do código não mudam nada.
import { Queue } from 'bullmq'
import { bullConnection, QUEUE_SEND_MESSAGE } from './connection'
import { config } from '../config'
import { prisma } from '../utils/prisma'

export interface SendJobData {
  messageId: string
}

const defaultJobOptions = {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

// Uma Queue por raia, criada 1x (módulo é singleton). Com queueLanes=1
// (default) vira, na prática, a mesma fila única de antes — só o nome muda
// (send-message-lane-0 em vez de send-message). BullMQ NÃO aceita ":" no
// nome da fila (usa ":" como separador interno de chave no Redis) — daí o
// "-" em vez de ":" aqui.
const lanes: Queue<SendJobData>[] = Array.from(
  { length: Math.max(1, config.sending.queueLanes) },
  (_, i) => new Queue<SendJobData>(`${QUEUE_SEND_MESSAGE}-lane-${i}`, {
    connection: bullConnection,
    defaultJobOptions,
  }),
)

// Hash simples (djb2) — não precisa de nada criptográfico, só distribuir bem.
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function laneFor(key: string): Queue<SendJobData> {
  return lanes[hashString(key) % lanes.length]
}

// Acha a raia de uma mensagem já persistida (instanceId, senão apiClientId).
async function laneForMessage(messageId: string): Promise<Queue<SendJobData> | null> {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { instanceId: true, apiClientId: true },
  })
  if (!msg) return null
  return laneFor(msg.instanceId ?? msg.apiClientId)
}

// ── Enfileira o envio de uma mensagem já persistida ───────────
// O retry/backoff é configurado por job a partir de Message.maxRetries.
//
// partitionKey (opcional): instanceId ?? apiClientId, quando o CHAMADOR já
// tem esse dado em mãos (acabou de criar a Message, por exemplo) — evita 1
// SELECT extra por mensagem só pra descobrir a raia. Achado real (teste de
// escala, 2026-08-18): sem isso, o lookup por mensagem praticamente
// dobrava o tempo de enfileiramento de um lote grande (15.000 mensagens
// foram de ~113s pra ~200s). Sem partitionKey, cai no lookup de antes
// (usado pelos caminhos de baixo volume: scheduler, reenvio manual).
export async function enqueueSend(messageId: string, maxRetries = 3, partitionKey?: string) {
  const lane = partitionKey ? laneFor(partitionKey) : (await laneForMessage(messageId)) ?? lanes[0]
  return lane.add(
    'send',
    { messageId },
    {
      attempts: Math.max(1, maxRetries),
      backoff: { type: 'exponential', delay: 5000 },
      jobId: messageId, // idempotência: 1 job por mensagem
    },
  )
}

// ── Remove o job de uma mensagem da fila (best-effort) ─────────
// Como usamos jobId = messageId, um job antigo (ex.: já falhado e mantido no
// histórico por removeOnFail) impediria re-enfileirar com o mesmo id. Remover
// antes garante que requeueSend crie um job novo. Não lança.
//
// Se a mensagem já não existir mais (ex.: cascade-delete, que chama isto
// ANTES de apagar o Message — ver cascade-delete.service.ts), não dá pra
// achar a raia por instanceId/apiClientId — tenta remover o jobId em TODAS
// as raias (barato, poucas dezenas no máximo, é o caminho raro).
export async function removeSendJob(messageId: string): Promise<void> {
  try {
    const lane = await laneForMessage(messageId)
    if (lane) {
      await lane.remove(messageId)
      return
    }
    await Promise.all(lanes.map((l) => l.remove(messageId).catch(() => {})))
  } catch {
    // job inexistente/já removido — ignorar
  }
}

// ── Re-enfileira uma mensagem (reenvio) ───────────────────────
// Remove o job anterior (mesmo jobId) e enfileira de novo. Usado pelo reenvio
// manual de mensagens com falha.
export async function requeueSend(messageId: string, maxRetries = 3, partitionKey?: string) {
  await removeSendJob(messageId)
  return enqueueSend(messageId, maxRetries, partitionKey)
}

// ── Verifica se o job de uma mensagem ainda está "vivo" na fila ──
// jobId = messageId (ver enqueueSend), então dá pra buscar direto via getJob.
// Usado pelo reenvio manual pra destravar mensagens presas em SENDING sem
// caminho de recuperação: se o job sumiu de vez (worker caiu repetidas vezes
// até estourar o maxStalledCount do BullMQ sem nunca marcar FAILED do lado da
// aplicação), a mensagem nunca mais será reprocessada sozinha — só resend
// manual resolve.
//
// IMPORTANTE: getJob() retorna o job mesmo depois de 'completed'/'failed' —
// ele só some de verdade quando o histórico é limpo (removeOnComplete/
// removeOnFail, aqui configurados pra manter até 1000/5000 jobs). Ou seja,
// "existir" no Redis não é o mesmo que "ainda vai rodar". Por isso checamos o
// estado: só tratamos como "ainda em jogo" (bloqueando o resend, pra não
// duplicar o envio) os estados que precedem uma nova tentativa/execução —
// waiting/delayed/prioritized/waiting-children/active. completed, failed ou
// job inexistente (ou 'unknown') contam como "não existe mais" pro resend.
export async function sendJobExists(messageId: string): Promise<boolean> {
  const lane = await laneForMessage(messageId)
  if (!lane) return false
  const job = await lane.getJob(messageId)
  if (!job) return false
  const state = await job.getState()
  const inFlight: (typeof state)[] = ['waiting', 'delayed', 'prioritized', 'waiting-children', 'active']
  return inFlight.includes(state)
}

// ── Contadores agregados (todas as raias somadas) — usado pelo monitor ─
export async function getSendQueueJobCounts() {
  const counts = await Promise.all(lanes.map((l) => l.getJobCounts()))
  const total: Record<string, number> = {}
  for (const c of counts) {
    for (const [key, value] of Object.entries(c)) {
      total[key] = (total[key] ?? 0) + value
    }
  }
  return total
}

// Exposto só pro worker subir 1 Worker por raia com o MESMO nome de fila.
export function sendQueueNames(): string[] {
  return lanes.map((l) => l.name)
}
