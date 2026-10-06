// src/queues/send-message.worker.ts
// Worker que consome a fila send-message: carrega a Message, envia (instância
// dedicada ou fallback do tenant), atualiza status e grava MessageAttempt.
// Retry com backoff exponencial é controlado pelo BullMQ (attempts/backoff do job).
import { Worker, type Job } from 'bullmq'
import { bullConnection } from './connection'
import { sendQueueNames, type SendJobData } from './send-message.queue'
import { config } from '../config'
import { prisma } from '../utils/prisma'
import { sendViaInstance, sendWithFallback } from '../services/provider-router.service'
import { dispatchWebhook } from '../services/notification.service'
import { logger } from '../utils/logger'
import type { SendMessagePayload, WhatsappButton, WhatsappListSection } from '../types'

let workers: Worker<SendJobData>[] = []

export async function processJob(job: Job<SendJobData>) {
  const { messageId } = job.data

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { instance: true, apiClient: true },
  })

  if (!message) {
    // Mensagem sumiu — nada a fazer, não re-tenta.
    logger.warn(`[Worker] Mensagem ${messageId} não encontrada, ignorando job`)
    return
  }

  // Mensagens já finalizadas/canceladas não são reenviadas
  if (['SENT', 'DELIVERED', 'READ', 'CANCELLED'].includes(message.status)) {
    return
  }

  // Recuperação de crash: se a mensagem já estava em SENDING quando
  // este job foi pego, é porque um worker anterior morreu no meio do envio e o
  // BullMQ redespachou o job "stalled". Em vez de reenviar cegamente, primeiro
  // checamos se já existe uma tentativa de SUCESSO registrada — nesse caso o
  // envio real já aconteceu e só faltou gravar o SENT final antes do worker
  // cair; apenas finalizamos o status, sem chamar o provider de novo.
  // Isso NÃO fecha 100% da janela: se o crash acontecer entre o provider
  // responder sucesso e o insert do MessageAttempt, ainda não há como
  // distinguir daqui — Evolution/WuzAPI não oferecem consulta por
  // providerId/dedupe do lado deles. Risco residual conhecido e documentado
  // (fora do escopo fechar 100% sem suporte do provider).
  if (message.status === 'SENDING') {
    const previousSuccess = await prisma.messageAttempt.findFirst({
      where: { messageId: message.id, success: true },
      orderBy: { createdAt: 'desc' },
    })
    if (previousSuccess) {
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: 'SENT',
          sentAt: previousSuccess.createdAt,
          provider: previousSuccess.provider,
          errorMessage: null,
        },
      })
      logger.warn(
        `[Worker] Mensagem ${message.id} recuperada de crash: tentativa de sucesso já registrada (attempt ${previousSuccess.attempt}), pulando reenvio`,
      )
      return
    }
  }

  // attemptsMade começa em 0 na 1ª execução
  const attemptNumber = job.attemptsMade + 1
  const isLastAttempt = attemptNumber >= (job.opts.attempts ?? 1)

  await prisma.message.update({
    where: { id: message.id },
    data: { status: 'SENDING', retryCount: attemptNumber - 1 },
  })

  // BUTTONS/LOCATION/CONTACT/POLL/LIST guardam campos extras em colunas Json próprias
  // (buttons/location/contact/poll/list); os demais tipos usam `content` como texto ou
  // URL de mídia. Ver src/utils/message-payload.ts para a mesma lógica no sentido
  // inverso (montagem do create a partir do payload recebido na API).
  const isButtons = message.type === 'BUTTONS'
  const isLocation = message.type === 'LOCATION'
  const isContact = message.type === 'CONTACT'
  const isPoll = message.type === 'POLL'
  const isList = message.type === 'LIST'
  const isText = message.type === 'TEXT'
  const buttonsData = (message.buttons ?? {}) as { footer?: string; buttons?: WhatsappButton[] }
  const locationData = (message.location ?? {}) as { latitude?: number; longitude?: number }
  const contactData = (message.contact ?? {}) as { phone?: string }
  const pollData = (message.poll ?? {}) as { options?: string[] }
  const listData = (message.list ?? {}) as {
    buttonText?: string
    title?: string
    footer?: string
    sections?: WhatsappListSection[]
  }

  const payload: SendMessagePayload = {
    to: message.toPhone,
    type: message.type,
    text: isText || isButtons || isPoll || isList ? message.content : undefined,
    mediaUrl: isText || isButtons || isLocation || isContact || isPoll || isList ? undefined : message.content,
    caption: message.caption ?? undefined,
    buttons: isButtons ? buttonsData.buttons : undefined,
    footer: isButtons ? buttonsData.footer : isList ? listData.footer : undefined,
    latitude: isLocation ? locationData.latitude : undefined,
    longitude: isLocation ? locationData.longitude : undefined,
    locationName: isLocation ? (message.content || undefined) : undefined,
    contactName: isContact ? message.content : undefined,
    contactPhone: isContact ? contactData.phone : undefined,
    pollOptions: isPoll ? pollData.options : undefined,
    listButtonText: isList ? listData.buttonText : undefined,
    listTitle: isList ? listData.title : undefined,
    listSections: isList ? listData.sections : undefined,
  }

  const start = Date.now()
  const result = message.instanceId && message.instance
    ? await sendViaInstance(message.instance, payload)
    : await sendWithFallback(message.apiClientId, payload)
  const duration = Date.now() - start

  // Histórico da tentativa
  await prisma.messageAttempt.create({
    data: {
      messageId: message.id,
      provider: result.provider ?? message.instance?.provider ?? 'EVOLUTION',
      instanceId: message.instanceId,
      attempt: attemptNumber,
      success: result.success,
      errorMsg: result.error,
      duration,
    },
  })

  if (result.success) {
    await prisma.message.update({
      where: { id: message.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        provider: result.provider,
        providerId: result.providerId,
        // Fase C3: registra qual número do pool efetivou o envio (quando houver).
        numberId: result.numberId ?? undefined,
        errorMessage: null,
      },
    })

    // Contador de billing da conta — incrementa só no envio efetivamente
    // confirmado (não em tentativas falhas nem em reenvios/retries do BullMQ,
    // já que este bloco só roda uma vez por mensagem, quando result.success).
    await prisma.apiClient.update({
      where: { id: message.apiClientId },
      data: { totalSent: { increment: 1 } },
    })

    // Confirmação de SUCESSO (escopada ao tenant). Opt-in: só quem assina
    // MESSAGE_DELIVERED recebe. Permite ao consumidor (ex.: um sistema de faturamento) confirmar o
    // envio real — não o otimista do QUEUED. Dispara uma vez, no sucesso do envio.
    await dispatchWebhook(
      'MESSAGE_DELIVERED',
      {
        messageId: message.id,
        to: message.toPhone,
        provider: result.provider,
        numberId: result.numberId ?? null,
      },
      message.apiClientId,
    )
    return
  }

  // Falha nesta tentativa
  if (isLastAttempt) {
    // Falha definitiva → FAILED + webhook MESSAGE_FAILED (escopado ao tenant)
    await prisma.message.update({
      where: { id: message.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMessage: result.error,
        provider: result.provider,
      },
    })

    await dispatchWebhook(
      'MESSAGE_FAILED',
      {
        messageId: message.id,
        to: message.toPhone,
        provider: result.provider,
        error: result.error,
        attempts: attemptNumber,
      },
      message.apiClientId,
    )
  }

  // Lança erro para o BullMQ agendar o retry com backoff
  throw new Error(result.error ?? 'Falha no envio')
}

// ── Inicializa 1 Worker POR RAIA da fila (chamado no boot do servidor) ─
// concurrency é POR RAIA (ver config.sending.workerConcurrency) — o total
// efetivo é queueLanes × workerConcurrency × nº de processos do cluster.
export function startSendMessageWorker(): Worker<SendJobData>[] {
  if (workers.length > 0) return workers

  workers = sendQueueNames().map((queueName) => {
    const w = new Worker<SendJobData>(queueName, processJob, {
      connection: bullConnection,
      concurrency: config.sending.workerConcurrency,
    })
    w.on('completed', (job) => {
      logger.info(`[Worker] Job ${job.id} concluído`)
    })
    w.on('failed', (job, err) => {
      logger.warn(`[Worker] Job ${job?.id} falhou (tentativa ${job?.attemptsMade}): ${err.message}`)
    })
    return w
  })

  return workers
}

export async function stopSendMessageWorker() {
  await Promise.all(workers.map((w) => w.close()))
  workers = []
}
