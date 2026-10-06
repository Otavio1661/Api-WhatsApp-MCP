// src/routes/messages.route.ts
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Prisma } from '@prisma/client'
import { authManage, memberScopeId } from '../middlewares/auth.middleware'
import { prisma } from '../utils/prisma'
import { enqueueSend, requeueSend, removeSendJob, sendJobExists } from '../queues/send-message.queue'
import { normalizePhone } from '../utils/helpers'
import { enforceRecipientHourlyLimit } from '../utils/recipient-rate-limit'
import { sendBodySchema as sendSchema } from '../schemas/message.schema'
import { buildMessageCreateFields } from '../utils/message-payload'
import { findInstanceByIdOrSlug } from '../services/instance.service'

// Escopo de MEMBER para mensagens: a Message não tem ownerUserId direto (só a
// Instance tem). Um MEMBER só pode ver/mexer em mensagens que ELE disparou
// (createdByUserId) OU que passam por uma instância da qual ele é dono
// (instance.ownerUserId) — cobre tanto o envio direto quanto o fallback da
// conta (instanceId nulo até o worker rotear). OWNER/admin/API key (machine)
// não têm memberScopeId → undefined → sem restrição extra (mesmo padrão do
// memberScopeId já usado em instances.route.ts).
function memberMessageFilter(request: FastifyRequest): Prisma.MessageWhereInput {
  const ownerUserId = memberScopeId(request)
  if (!ownerUserId) return {}
  return { OR: [{ createdByUserId: ownerUserId }, { instance: { ownerUserId } }] }
}

export async function messagesRoutes(app: FastifyInstance) {
  // ── POST /messages — Enviar mensagem ─────────────────────────
  app.post('/messages', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const body = sendSchema.safeParse(request.body)
      if (!body.success) {
        return reply.status(400).send({ error: 'Payload inválido', details: body.error.flatten() })
      }

      const apiClientId = request.apiClient!.id
      const payload = body.data
      const to = normalizePhone(payload.to)

      try {
        // Idempotência por tenant: verifica externalId no escopo do cliente
        if (payload.externalId) {
          const existing = await prisma.message.findUnique({
            where: { apiClientId_externalId: { apiClientId, externalId: payload.externalId } },
          })
          if (existing) {
            return reply.status(200).send({ id: existing.id, status: existing.status, duplicate: true })
          }
        }

        // Se instanceId informado, valida posse pelo tenant E, se MEMBER, pelo dono
        // da instância (memberScopeId) — senão um MEMBER poderia usar a instância
        // de outro MEMBER da mesma conta.
        if (payload.instanceId) {
          const owned = await findInstanceByIdOrSlug(payload.instanceId, apiClientId, memberScopeId(request))
          if (!owned) {
            return reply.status(404).send({ error: 'Instância não encontrada' })
          }
        }

        const isScheduled = Boolean(payload.scheduledAt)

        // Limite anti-flood por destinatário (por conta, janela de 1h). Aplica só a
        // envios imediatos — agendados são checados de novo pelo scheduler (Scheduler.
        // processScheduledMessages), no momento em que forem efetivamente enfileirados,
        // já que N agendamentos pro mesmo número/minuto não passam por aqui em série.
        // Bloqueia ANTES de criar a Message e o job, para não entupir banco nem fila.
        if (!isScheduled) {
          const podeProsseguir = await enforceRecipientHourlyLimit(
            request,
            reply,
            apiClientId,
            to,
            request.apiClient!.maxPerRecipientPerHour,
          )
          if (!podeProsseguir) return
        }

        // Cria registro no banco (QUEUED ou SCHEDULED)
        const message = await prisma.message.create({
          data: {
            apiClientId,
            externalId: payload.externalId,
            instanceId: payload.instanceId,
            toPhone: to,
            ...buildMessageCreateFields(payload),
            scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : undefined,
            status: isScheduled ? 'SCHEDULED' : 'QUEUED',
            createdByUserId: request.authUser?.id, // null se for envio por API key/token
          },
        })

        // Agendada: o job scheduled-messages enfileira no horário
        if (isScheduled) {
          return reply.status(202).send({ id: message.id, status: 'SCHEDULED' })
        }

        // Imediata: enfileira e responde 202 sem aguardar o envio. Passa a
        // raia já resolvida (instanceId ?? apiClientId, já em mãos) — evita
        // 1 SELECT extra por mensagem (ver comentário em enqueueSend).
        await enqueueSend(message.id, message.maxRetries, message.instanceId ?? message.apiClientId)
        return reply.status(202).send({ id: message.id, status: 'QUEUED' })
      } catch (err: any) {
        request.log.error(`[Messages] Falha ao criar/enfileirar mensagem: ${err.message}`)
        return reply.status(500).send({ error: 'Falha ao processar a mensagem' })
      }
    },
  })

  // ── GET /messages/:id — Status de uma mensagem (escopado) ────
  app.get<{ Params: { id: string } }>('/messages/:id', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const message = await prisma.message.findFirst({
        where: { id: request.params.id, apiClientId: request.apiClient!.id, ...memberMessageFilter(request) },
        include: { attempts: true },
      })

      if (!message) return reply.status(404).send({ error: 'Mensagem não encontrada' })
      return reply.send(message)
    },
  })

  // ── GET /messages — Lista mensagens do tenant com filtros ────
  app.get('/messages', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const query = request.query as { status?: string; page?: string; limit?: string }
      const page = Math.max(1, Number(query.page ?? 1))
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)))

      const where = {
        apiClientId: request.apiClient!.id,
        ...(query.status ? { status: query.status as any } : {}),
        ...memberMessageFilter(request),
      }

      const messages = await prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      })

      const total = await prisma.message.count({ where })

      return reply.send({ data: messages, page, limit, total })
    },
  })

  // ── POST /messages/:id/resend — Reenfileira uma mensagem com falha ─
  // Permite reenviar mensagens em FAILED (reenviar uma já entregue duplicaria
  // o envio). Também permite reenviar mensagens presas em SENDING quando o job
  // correspondente já não existe mais na fila (worker morreu de vez
  // e o BullMQ estourou o maxStalledCount sem nunca marcar FAILED — sem isso a
  // mensagem ficava travada em SENDING pra sempre, sem caminho de recuperação).
  // Se o job ainda existe (ex.: esperando o backoff entre tentativas), o
  // reenvio continua bloqueado pra não duplicar o envio.
  app.post<{ Params: { id: string } }>('/messages/:id/resend', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const message = await prisma.message.findFirst({
        where: { id: request.params.id, apiClientId: request.apiClient!.id, ...memberMessageFilter(request) },
      })
      if (!message) return reply.status(404).send({ error: 'Mensagem não encontrada' })

      const stuckSending = message.status === 'SENDING' && !(await sendJobExists(message.id))
      if (message.status !== 'FAILED' && !stuckSending) {
        return reply.status(409).send({
          error: 'Só é possível reenviar mensagens com falha (FAILED), ou presas em SENDING sem job ativo na fila',
          status: message.status,
        })
      }

      const updated = await prisma.message.update({
        where: { id: message.id },
        data: {
          status: 'QUEUED',
          retryCount: 0,
          errorMessage: null,
          failedAt: null,
        },
      })

      await requeueSend(updated.id, updated.maxRetries, updated.instanceId ?? updated.apiClientId)
      return reply.status(202).send({ id: updated.id, status: updated.status })
    },
  })

  // ── DELETE /messages/:id — Remove a mensagem do histórico ─────
  // Escopado ao tenant. Remove as tentativas (sem onDelete cascade no schema) e a
  // mensagem numa transação, e tira o job da fila (best-effort).
  app.delete<{ Params: { id: string } }>('/messages/:id', {
    preHandler: authManage,
    handler: async (request, reply) => {
      const message = await prisma.message.findFirst({
        where: { id: request.params.id, apiClientId: request.apiClient!.id, ...memberMessageFilter(request) },
        select: { id: true },
      })
      if (!message) return reply.status(404).send({ error: 'Mensagem não encontrada' })

      await prisma.$transaction([
        prisma.messageAttempt.deleteMany({ where: { messageId: message.id } }),
        prisma.message.delete({ where: { id: message.id } }),
      ])
      await removeSendJob(message.id)

      return reply.status(204).send()
    },
  })
}
