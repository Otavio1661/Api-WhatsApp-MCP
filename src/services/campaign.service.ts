// src/services/campaign.service.ts
// Núcleo do envio em LOTE (campanha), extraído de campaigns.route.ts pra ser
// reusado tanto pela API pública (/v1/campaigns) quanto pelo formulário do
// painel (/admin/campaigns) — MESMA lógica, MESMO anti-flood/fila/idempotência,
// só muda quem chama (API key vs sessão do painel).
import { prisma } from '../utils/prisma'
import { enqueueSend } from '../queues/send-message.queue'
import { normalizePhone } from '../utils/helpers'
import { checkRecipientHourlyLimit } from '../utils/recipient-rate-limit'

const CHUNK_SIZE = 25

export interface CampaignInput {
  apiClientId: string
  authUserId?: string
  maxPerRecipientPerHour: number
  to: string[]
  type?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT'
  text?: string
  mediaUrl?: string
  caption?: string
  instanceId?: string
  name?: string
  externalIdPrefix?: string
}

export interface RecipientResult {
  to: string
  status: 'QUEUED' | 'RATE_LIMITED' | 'DUPLICATE'
  id?: string
  retryAfterSec?: number
}

export interface CampaignSummary {
  campaignId?: string
  total: number
  queued: number
  rateLimited: number
  duplicates: number
  results: RecipientResult[]
}

// Cria as mensagens de um lote (dedupe + anti-flood por destinatário + fila),
// registra o Campaign se pelo menos 1 mensagem foi enfileirada, e devolve o
// resumo. Não valida posse de instância nem payload — isso é responsabilidade
// do caller (rota API valida com zod, rota do painel valida o form).
export async function createCampaignBatch(input: CampaignInput): Promise<CampaignSummary> {
  const { apiClientId, authUserId, maxPerRecipientPerHour } = input
  const content = input.text ?? input.mediaUrl ?? ''
  const type = input.type ?? 'TEXT'

  // Dedupe dos destinos já normalizados (evita disparar 2x pro mesmo número no lote).
  const phones = [...new Set(input.to.map(normalizePhone))]

  const processarDestinatario = async (to: string): Promise<RecipientResult> => {
    // Idempotência opcional por destino.
    const externalId = input.externalIdPrefix ? `${input.externalIdPrefix}:${to}` : undefined
    if (externalId) {
      const existing = await prisma.message.findUnique({
        where: { apiClientId_externalId: { apiClientId, externalId } },
        select: { id: true },
      })
      if (existing) {
        return { to, status: 'DUPLICATE', id: existing.id }
      }
    }

    // Teto anti-flood por destinatário (mesma janela/contador da rota single).
    const rl = await checkRecipientHourlyLimit(apiClientId, to, maxPerRecipientPerHour)
    if (!rl.allowed) {
      return { to, status: 'RATE_LIMITED', retryAfterSec: rl.retryAfterSec }
    }

    const message = await prisma.message.create({
      data: {
        apiClientId,
        externalId,
        instanceId: input.instanceId,
        toPhone: to,
        type,
        content,
        caption: input.caption,
        status: 'QUEUED',
        createdByUserId: authUserId,
      },
    })
    // Raia já resolvida (instanceId ?? apiClientId, já em mãos) — evita 1 SELECT
    // extra por mensagem; campanha é o caminho de MAIOR volume, onde isso mais pesa.
    await enqueueSend(message.id, message.maxRetries, input.instanceId ?? apiClientId)
    return { to, status: 'QUEUED', id: message.id }
  }

  // Processa em lotes com concorrência limitada — CHUNK_SIZE em paralelo por vez,
  // em vez de 1 destinatário por vez em série.
  const results: RecipientResult[] = []
  for (let i = 0; i < phones.length; i += CHUNK_SIZE) {
    const chunk = phones.slice(i, i + CHUNK_SIZE)
    const chunkResults = await Promise.all(chunk.map(processarDestinatario))
    results.push(...chunkResults)
  }
  const queuedIds = results.filter((r) => r.status === 'QUEUED' && r.id).map((r) => r.id as string)

  // Registra o lote (Campaign) só se houve envio — vincula as mensagens criadas.
  let campaignId: string | undefined
  if (queuedIds.length > 0) {
    const campaign = await prisma.campaign.create({
      data: {
        apiClientId,
        name: input.name,
        instanceId: input.instanceId,
        createdByUserId: authUserId,
        total: queuedIds.length,
      },
    })
    campaignId = campaign.id
    await prisma.message.updateMany({ where: { id: { in: queuedIds } }, data: { campaignId } })
  }

  return {
    campaignId,
    total: phones.length,
    queued: queuedIds.length,
    rateLimited: results.filter((r) => r.status === 'RATE_LIMITED').length,
    duplicates: results.filter((r) => r.status === 'DUPLICATE').length,
    results,
  }
}
