// src/routes/campaigns.route.ts
// Envio em LOTE (campanha) para uma lista de destinos. Reusa TODA a infra existente:
//   - teto anti-flood por destinatário (checkRecipientHourlyLimit)
//   - fila send-message + worker (que já aplica o espaçamento anti-ban via rate-gate)
//   - idempotência por externalId (mesma da rota single)
// Cada lote vira um Campaign (acompanhamento) e cada destino uma Message (campaignId).
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authManage, memberScopeId } from '../middlewares/auth.middleware'
import { prisma } from '../utils/prisma'
import { getCampaignProgress } from '../services/monitor.service'
import { createCampaignBatch } from '../services/campaign.service'
import { findInstanceByIdOrSlug } from '../services/instance.service'

const SENT_STATUSES = ['SENT', 'DELIVERED', 'READ']
const QUEUED_STATUSES = ['QUEUED', 'SENDING', 'SCHEDULED']

const MAX_RECIPIENTS = 1000

const campaignSchema = z.object({
  to: z.array(z.string().min(10).max(15)).min(1).max(MAX_RECIPIENTS),
  type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']).default('TEXT'),
  text: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  caption: z.string().optional(),
  instanceId: z.string().optional(),
  // Rótulo opcional do lote (aparece no monitor).
  name: z.string().min(1).max(120).optional(),
  // Prefixo opcional para idempotência por destino: externalId = `${prefix}:${telefone}`.
  externalIdPrefix: z.string().min(1).max(80).optional(),
})

export async function campaignsRoutes(app: FastifyInstance) {
  // ── POST /campaigns — Dispara uma mensagem para uma lista de destinos ─
  app.post('/campaigns', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const body = campaignSchema.safeParse(request.body)
      if (!body.success) {
        return reply.status(400).send({ error: 'Payload inválido', details: body.error.flatten() })
      }
      const apiClientId = request.apiClient!.id
      const payload = body.data

      // Valida posse da instância (se informada) — escopo da conta E, se MEMBER,
      // do dono da instância (memberScopeId) — senão um MEMBER poderia disparar
      // campanha usando a instância de outro MEMBER da mesma conta.
      if (payload.instanceId) {
        const owned = await findInstanceByIdOrSlug(payload.instanceId, apiClientId, memberScopeId(request))
        if (!owned) return reply.status(404).send({ error: 'Instância não encontrada' })
      }

      const summary = await createCampaignBatch({
        apiClientId,
        authUserId: request.authUser?.id,
        maxPerRecipientPerHour: request.apiClient!.maxPerRecipientPerHour,
        ...payload,
      })
      return reply.status(202).send(summary)
    },
  })

  // ── GET /campaigns — Lista lotes com progresso (escopo por papel) ─
  app.get('/campaigns', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const q = request.query as { limit?: string }
      const limit = Math.min(50, Math.max(1, Number(q.limit ?? 20)))
      const campaigns = await getCampaignProgress({
        apiClientId: request.apiClient!.id,
        ownerUserId: memberScopeId(request),
        limit,
      })
      return reply.send({ data: campaigns })
    },
  })

  // ── GET /campaigns/:id — Progresso de um lote (escopado) ─
  app.get<{ Params: { id: string } }>('/campaigns/:id', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const ownerUserId = memberScopeId(request)
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: request.params.id,
          apiClientId: request.apiClient!.id,
          ...(ownerUserId ? { createdByUserId: ownerUserId } : {}),
        },
        select: { id: true, name: true, total: true, createdAt: true, instance: { select: { name: true, slug: true } } },
      })
      if (!campaign) return reply.status(404).send({ error: 'Campanha não encontrada' })

      const grouped = await prisma.message.groupBy({
        by: ['status'],
        where: { campaignId: campaign.id },
        _count: { _all: true },
      })
      let sent = 0, failed = 0, queued = 0
      for (const g of grouped) {
        if (SENT_STATUSES.includes(g.status)) sent += g._count._all
        else if (g.status === 'FAILED') failed += g._count._all
        else if (QUEUED_STATUSES.includes(g.status)) queued += g._count._all
      }
      return reply.send({ ...campaign, sent, failed, queued })
    },
  })
}
