// src/routes/inbound-messages.route.ts
// Consulta (polling) das mensagens recebidas — persistidas em
// webhooks.route.ts a partir do callback inbound de cada provider. Mesmo
// papel do MESSAGE_RECEIVED via webhook próprio, mas pra quem não tem (ou
// não quer manter) um endpoint próprio rodando 24/7.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { authManage, memberScopeId } from '../middlewares/auth.middleware'
import { prisma } from '../utils/prisma'
import { providers } from '../providers'
import type { EvolutionProvider } from '../providers/evolution.provider'
import { base64Bytes, MAX_MEDIA_BYTES } from '../services/inbound-media.service'
import { transcribeAudio } from '../services/gemini.service'

// MEMBER só vê inbound das PRÓPRIAS instâncias — sem @relation formal em
// InboundMessage, resolve via uma sub-consulta dos ids de instância do
// tenant que o MEMBER possui (mesmo espírito de memberMessageFilter em
// messages.route.ts, adaptado pra não depender de relation).
async function memberInstanceIds(request: FastifyRequest, apiClientId: string): Promise<string[] | null> {
  const ownerUserId = memberScopeId(request)
  if (!ownerUserId) return null // OWNER/SUPER_ADMIN: sem filtro (vê tudo do tenant)
  const instances = await prisma.instance.findMany({
    where: { apiClientId, ownerUserId },
    select: { id: true },
  })
  return instances.map((i) => i.id)
}

const WAIT_MAX_SECONDS = 25
const WAIT_TICK_MS = 1000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function inboundMessagesRoutes(app: FastifyInstance) {
  // ── GET /inbound-messages — Lista mensagens recebidas (polling) ─
  app.get('/inbound-messages', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const query = request.query as { instanceId?: string; page?: string; limit?: string; sinceId?: string }
      const page = Math.max(1, Number(query.page ?? 1))
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)))
      const apiClientId = request.apiClient!.id

      const scopedIds = await memberInstanceIds(request, apiClientId)
      if (scopedIds !== null && scopedIds.length === 0) {
        return reply.send({ data: [], page, limit, total: 0 })
      }
      if (scopedIds !== null && query.instanceId && !scopedIds.includes(query.instanceId)) {
        return reply.send({ data: [], page, limit, total: 0 })
      }

      const where = {
        apiClientId,
        instanceId: query.instanceId ? query.instanceId : scopedIds !== null ? { in: scopedIds } : undefined,
      }

      const [data, total] = await Promise.all([
        prisma.inboundMessage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.inboundMessage.count({ where }),
      ])

      return reply.send({ data, page, limit, total })
    },
  })

  // ── GET /inbound-messages/wait — Long-poll: segura a request até chegar
  // mensagem nova (createdAt > since) ou estourar timeoutSec, checando o banco
  // a cada 1s. É 1 request por espera (não 1 por checagem), então não estoura o
  // rate-limit por tenant. `nextSince` é o cursor pra próxima chamada não
  // perder nada entre uma espera e outra. Mesmo escopo/auth do list.
  app.get('/inbound-messages/wait', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const query = request.query as { instanceId?: string; since?: string; timeoutSec?: string }
      const apiClientId = request.apiClient!.id
      const startedAt = new Date()

      let since = startedAt
      if (query.since) {
        const parsed = new Date(query.since)
        if (Number.isNaN(parsed.getTime())) {
          return reply.status(400).send({ error: 'since inválido (use ISO 8601)' })
        }
        since = parsed
      }
      const timeoutSec = Math.min(WAIT_MAX_SECONDS, Math.max(1, Number(query.timeoutSec ?? 20) || 20))

      const scopedIds = await memberInstanceIds(request, apiClientId)
      const emptyScope =
        (scopedIds !== null && scopedIds.length === 0) ||
        (scopedIds !== null && !!query.instanceId && !scopedIds.includes(query.instanceId))

      const where = {
        apiClientId,
        instanceId: query.instanceId ? query.instanceId : scopedIds !== null ? { in: scopedIds } : undefined,
        createdAt: { gt: since },
      }

      const deadline = startedAt.getTime() + timeoutSec * 1000
      while (!emptyScope && !request.raw.destroyed) {
        const data = await prisma.inboundMessage.findMany({ where, orderBy: { createdAt: 'asc' }, take: 50 })
        if (data.length > 0) {
          return reply.send({ data, timedOut: false, nextSince: data[data.length - 1].createdAt.toISOString() })
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        await sleep(Math.min(WAIT_TICK_MS, remaining))
      }

      return reply.send({ data: [], timedOut: true, nextSince: since.toISOString() })
    },
  })
  // Resolve a mensagem (tenant + escopo MEMBER) e baixa a mídia na Evolution.
  // Nome da sessão na Evolution: `num-<id>` se a mensagem veio de um número, senão o da instância.
  async function loadInboundMedia(request: FastifyRequest<{ Params: { id: string } }>) {
    const apiClientId = request.apiClient!.id
    const msg = await prisma.inboundMessage.findFirst({ where: { id: request.params.id, apiClientId } })
    if (!msg) return { ok: false, status: 404, error: 'Mensagem não encontrada' } as const

    const scopedIds = await memberInstanceIds(request, apiClientId)
    if (scopedIds !== null && !scopedIds.includes(msg.instanceId)) {
      return { ok: false, status: 404, error: 'Mensagem não encontrada' } as const
    }
    if (!msg.mediaType || !msg.providerMessageId) return { ok: false, status: 404, error: 'Mensagem sem mídia' } as const

    let provider: string | undefined
    let providerName: string | null | undefined
    if (msg.numberId) {
      const number = await prisma.instanceNumber.findUnique({ where: { id: msg.numberId } })
      provider = number?.provider
      providerName = number ? (number.providerInstanceId ?? `num-${number.id}`) : undefined
    } else {
      const instance = await prisma.instance.findUnique({ where: { id: msg.instanceId } })
      provider = instance?.provider
      providerName = instance?.instanceId
    }
    if (provider !== 'EVOLUTION' || !providerName) {
      return { ok: false, status: 501, error: 'Download de mídia só é suportado em instâncias Evolution' } as const
    }

    const media = await (providers.EVOLUTION as EvolutionProvider).getMediaBase64(providerName, msg.providerMessageId)
    if (!media) return { ok: false, status: 502, error: 'Mídia indisponível na Evolution' } as const
    if (base64Bytes(media.base64) > MAX_MEDIA_BYTES) return { ok: false, status: 413, error: 'Mídia grande demais' } as const
    return { ok: true, msg, media } as const
  }

  // ── GET /inbound-messages/:id/media — binário da mídia recebida ─
  // Baixa sob demanda na Evolution (nada de mídia fica guardado no banco).
  app.get<{ Params: { id: string } }>('/inbound-messages/:id/media', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const r = await loadInboundMedia(request)
      if (!r.ok) return reply.status(r.status).send({ error: r.error })
      return reply.send({ mediaType: r.msg.mediaType, mimetype: r.media.mimetype ?? r.msg.mimetype, base64: r.media.base64 })
    },
  })

  // ── POST /inbound-messages/:id/transcribe — transcrição SOB DEMANDA ─
  // Áudio de outro número (fromMe=false) não é transcrito no webhook (privacidade/cota);
  // quando o bridge decide que aquele chat é dele, pede aqui. Grava em `text`.
  app.post<{ Params: { id: string } }>('/inbound-messages/:id/transcribe', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const r = await loadInboundMedia(request)
      if (!r.ok) return reply.status(r.status).send({ error: r.error })
      if (r.msg.mediaType !== 'audio') return reply.status(400).send({ error: 'Só áudio pode ser transcrito' })
      if (r.msg.text) return reply.send({ text: r.msg.text, cached: true })

      const text = await transcribeAudio(r.media.base64, r.media.mimetype ?? r.msg.mimetype ?? 'audio/ogg')
      if (!text) return reply.status(502).send({ error: 'Transcrição indisponível' })
      await prisma.inboundMessage.update({ where: { id: r.msg.id }, data: { text } })
      return reply.send({ text, cached: false })
    },
  })
}
