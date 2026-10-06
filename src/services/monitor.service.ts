// src/services/monitor.service.ts
// Dados de acompanhamento ao vivo: filas (BullMQ), mensagens recentes e campanhas (lotes).
// Escopo por papel: o caller passa ownerUserId (MEMBER) para restringir; ausente = conta inteira.
// getQueueStats é GLOBAL (infra da plataforma) → usar só para super admin.
import type { MessageStatus, Prisma } from '@prisma/client'
import { prisma } from '../utils/prisma'
import { getSendQueueJobCounts } from '../queues/send-message.queue'
import { webhookQueue } from '../queues/webhook.queue'

const SENT_STATUSES = ['SENT', 'DELIVERED', 'READ'] as const
const QUEUED_STATUSES = ['QUEUED', 'SENDING', 'SCHEDULED'] as const

// Contadores das filas BullMQ (waiting/active/delayed/completed/failed). Só super admin.
// send-message é dividida em raias (ver send-message.queue.ts) — getSendQueueJobCounts
// já soma todas antes de devolver, o chamador aqui não precisa saber disso.
export async function getQueueStats() {
  const [sendMessage, webhook] = await Promise.all([
    getSendQueueJobCounts(),
    webhookQueue.getJobCounts(),
  ])
  return { sendMessage, webhook }
}

// IDs das instâncias visíveis ao caller (todas da conta, ou só as do dono = MEMBER).
async function visibleInstanceIds(apiClientId: string, ownerUserId?: string): Promise<string[]> {
  const list = await prisma.instance.findMany({
    where: { apiClientId, ...(ownerUserId ? { ownerUserId } : {}) },
    select: { id: true },
  })
  return list.map((i) => i.id)
}

// Últimas mensagens (com instância, status e QUEM enviou). Escopo por papel +
// filtros opcionais por status e por instância (do painel/monitor).
// Paginado: `page` (1-based) + `limit` por página; devolve também o total de
// registros que casam com o filtro, pra a UI mostrar contagem e navegação.
export async function getRecentMessages(input: {
  apiClientId: string
  ownerUserId?: string
  limit?: number
  page?: number
  status?: MessageStatus
  instanceId?: string
}) {
  const { apiClientId, ownerUserId, status, instanceId } = input
  const limit = Math.min(100, Math.max(1, input.limit ?? 25))
  const page = Math.max(1, input.page ?? 1)

  // Resolve o filtro de instância respeitando o escopo do MEMBER.
  let instanceWhere: Prisma.StringNullableFilter | string | undefined
  if (instanceId) {
    if (ownerUserId) {
      const ids = await visibleInstanceIds(apiClientId, ownerUserId)
      if (!ids.includes(instanceId)) return { messages: [], total: 0, page: 1, limit } // instância não é do membro
    }
    instanceWhere = instanceId
  } else if (ownerUserId) {
    const ids = await visibleInstanceIds(apiClientId, ownerUserId)
    if (ids.length === 0) return { messages: [], total: 0, page: 1, limit }
    instanceWhere = { in: ids }
  }

  const where = {
    apiClientId,
    ...(instanceWhere ? { instanceId: instanceWhere } : {}),
    ...(status ? { status } : {}),
  }

  const [total, messages] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        toPhone: true,
        status: true,
        type: true,
        createdAt: true,
        errorMessage: true,
        instance: { select: { name: true, slug: true } },
        createdByUser: { select: { name: true, email: true } },
      },
    }),
  ])
  // Achata o "enviado por" para a view (nome > e-mail > "API/sistema").
  const flattened = messages.map((m) => {
    const { createdByUser, ...rest } = m
    return {
      ...rest,
      sentBy: createdByUser ? createdByUser.name || createdByUser.email : null,
    }
  })
  return { messages: flattened, total, page, limit }
}

// Campanhas (lotes) recentes com progresso agregado das mensagens.
export async function getCampaignProgress(input: {
  apiClientId: string
  ownerUserId?: string
  limit?: number
}) {
  const { apiClientId, ownerUserId } = input
  const limit = Math.min(50, Math.max(1, input.limit ?? 20))

  // MEMBER vê só as campanhas que ele disparou; OWNER/admin veem as da conta.
  const campaigns = await prisma.campaign.findMany({
    where: { apiClientId, ...(ownerUserId ? { createdByUserId: ownerUserId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      name: true,
      total: true,
      createdAt: true,
      instance: { select: { name: true, slug: true } },
    },
  })
  if (campaigns.length === 0) return []

  // Progresso: groupBy mensagens por campanha+status (uma query só).
  const ids = campaigns.map((c) => c.id)
  const grouped = await prisma.message.groupBy({
    by: ['campaignId', 'status'],
    where: { campaignId: { in: ids } },
    _count: { _all: true },
  })
  const acc = new Map<string, { sent: number; failed: number; queued: number; done: number }>()
  for (const row of grouped) {
    if (!row.campaignId) continue
    const a = acc.get(row.campaignId) ?? { sent: 0, failed: 0, queued: 0, done: 0 }
    const n = row._count._all
    a.done += n
    if ((SENT_STATUSES as readonly string[]).includes(row.status)) a.sent += n
    else if (row.status === 'FAILED') a.failed += n
    else if ((QUEUED_STATUSES as readonly string[]).includes(row.status)) a.queued += n
    acc.set(row.campaignId, a)
  }

  return campaigns.map((c) => {
    const p = acc.get(c.id) ?? { sent: 0, failed: 0, queued: 0, done: 0 }
    return {
      id: c.id,
      name: c.name,
      instance: c.instance,
      total: c.total,
      sent: p.sent,
      failed: p.failed,
      queued: p.queued,
      createdAt: c.createdAt,
    }
  })
}
