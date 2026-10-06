// src/services/cascade-delete.service.ts
// Deleção em cascata (DESTRUTIVA) de instância e de conta, exclusiva do super admin.
//
// O schema tem FKs RESTRICT (Message→Instance, NumberRotation→Instance, MessageAttempt→
// Message, Message/User/Webhook→ApiClient), então `prisma.instance.delete` ou
// `prisma.apiClient.delete` diretos QUEBRAM por violação de FK quando há filhos. Aqui
// apagamos os filhos na ordem correta dentro de UMA $transaction (tudo ou nada — sem
// lixo órfão e sem SQL cru). InstanceNumber→Instance é Cascade no banco, então some
// junto com a instância; Message/NumberRotation por numberId são SetNull.
//
// Efeitos colaterais best-effort (FORA da transação, pois tocam sistemas externos):
//   - remoção da sessão no provider (Evolution/WuzAPI/CloudAPI)
//   - limpeza de chaves no Redis (contador anti-flood por destinatário + locks anti-ban)
import type { FastifyBaseLogger } from 'fastify'
import type { ApiClient, Instance, InstanceNumber } from '@prisma/client'
import { prisma } from '../utils/prisma'
import { providers } from '../providers'
import { redis } from '../utils/redis'
import { removeSendJob } from '../queues/send-message.queue'
import { auditLogEntry, type AuditActor } from './audit-log.service'

type InstanceWithNumbers = Instance & { numbers: InstanceNumber[] }

// Retrato mínimo da instância pro AuditLog — sem token/webhookSecret (segredos).
function instanceSnapshot(instance: InstanceWithNumbers) {
  return {
    id: instance.id,
    name: instance.name,
    slug: instance.slug,
    phone: instance.phone,
    label: instance.label,
    provider: instance.provider,
    status: instance.status,
    apiClientId: instance.apiClientId,
    ownerUserId: instance.ownerUserId,
    numbersCount: instance.numbers.length,
  }
}

// Retrato mínimo da conta pro AuditLog — sem apiKey (segredo).
function clientSnapshot(client: ApiClient & { instances: InstanceWithNumbers[] }) {
  return {
    id: client.id,
    name: client.name,
    role: client.role,
    active: client.active,
    fallbackEnabled: client.fallbackEnabled,
    rateLimit: client.rateLimit,
    maxInstances: client.maxInstances,
    maxPerRecipientPerHour: client.maxPerRecipientPerHour,
    totalSent: client.totalSent,
    createdAt: client.createdAt,
    instancesCount: client.instances.length,
  }
}

// Best-effort: remove a sessão da instância e de cada número no provider. Nunca lança.
async function cleanupProviders(instance: InstanceWithNumbers, log?: FastifyBaseLogger): Promise<void> {
  const targets: Array<{ provider: InstanceNumber['provider']; providerInstanceId: string }> = []
  if (instance.instanceId) targets.push({ provider: instance.provider, providerInstanceId: instance.instanceId })
  for (const n of instance.numbers) {
    if (n.providerInstanceId) targets.push({ provider: n.provider, providerInstanceId: n.providerInstanceId })
  }
  for (const t of targets) {
    try {
      await providers[t.provider].deleteInstance(t.providerInstanceId)
    } catch (err: any) {
      log?.warn(`[CascadeDelete] Falha ao remover sessão no provider (best-effort): ${err.message}`)
    }
  }
}

// Best-effort: remove chaves Redis ligadas à instância (locks/espaçamento anti-ban). Nunca lança.
async function cleanupInstanceRedis(instanceId: string, log?: FastifyBaseLogger): Promise<void> {
  try {
    await redis.del(`lastsent:${instanceId}`, `lock:send:${instanceId}`)
  } catch (err: any) {
    log?.warn(`[CascadeDelete] Falha ao limpar Redis da instância (best-effort): ${err.message}`)
  }
}

// BUG REAL (achado em teste de carga, 2026-08-18): sem isto, o worker do
// BullMQ continua processando mensagens desta instância/conta EM PARALELO
// com a transação de exclusão abaixo — se ele inserir um MessageAttempt
// novo entre o DELETE de MessageAttempt e o DELETE de Message (mesma
// transação, mas o worker roda na dele própria), a FK RESTRICT
// (MessageAttempt→Message) derruba a transação inteira com 500. Tirar os
// jobs da fila ANTES não fecha 100% a janela (um job já em processamento
// não é afetado), mas elimina a esmagadora maioria dos casos reais — é uma
// operação rara e deliberada (exclusão definitiva), não um hot path.
async function removeQueuedJobs(messageIds: string[], log?: FastifyBaseLogger): Promise<void> {
  await Promise.all(
    messageIds.map(async (id) => {
      try {
        await removeSendJob(id)
      } catch (err: any) {
        log?.warn(`[CascadeDelete] Falha ao remover job da fila (best-effort): ${err.message}`)
      }
    }),
  )
}

/**
 * Apaga DEFINITIVAMENTE uma instância e tudo que depende dela.
 * Retorna a instância removida, ou null se não existir (caller → 404).
 */
export async function deleteInstanceCascade(
  instanceId: string,
  log?: FastifyBaseLogger,
  actor?: AuditActor,
): Promise<Instance | null> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    include: { numbers: true },
  })
  if (!instance) return null

  await cleanupProviders(instance, log)
  await cleanupInstanceRedis(instance.id, log)

  const pendentes = await prisma.message.findMany({ where: { instanceId }, select: { id: true } })
  await removeQueuedJobs(pendentes.map((m) => m.id), log)

  // Ordem: tentativas → mensagens → rotações → instância (InstanceNumber cascateia).
  // AuditLog (se `actor` informado) entra na MESMA transação — nunca escrita à parte.
  await prisma.$transaction([
    prisma.messageAttempt.deleteMany({ where: { message: { instanceId } } }),
    prisma.message.deleteMany({ where: { instanceId } }),
    prisma.numberRotation.deleteMany({ where: { instanceId } }),
    prisma.instance.delete({ where: { id: instanceId } }),
    ...(actor
      ? [auditLogEntry(actor, 'DELETE_INSTANCE_CASCADE', 'Instance', instance.id, instanceSnapshot(instance))]
      : []),
  ])

  return instance
}

/**
 * Apaga DEFINITIVAMENTE uma conta (ApiClient) e TUDO que for relacional:
 * instâncias (+ números), mensagens, tentativas, rotações, webhooks e usuários.
 * Retorna a conta removida, ou null se não existir (caller → 404).
 */
export async function deleteClientCascade(
  clientId: string,
  log?: FastifyBaseLogger,
  actor?: AuditActor,
): Promise<ApiClient | null> {
  const client = await prisma.apiClient.findUnique({
    where: { id: clientId },
    include: { instances: { include: { numbers: true } } },
  })
  if (!client) return null

  // Efeitos externos best-effort por instância (provider + locks Redis).
  for (const inst of client.instances) {
    await cleanupProviders(inst, log)
    await cleanupInstanceRedis(inst.id, log)
  }
  // Contadores anti-flood por destinatário desta conta.
  try {
    const keys = await redis.keys(`rl:rcpt:${clientId}:*`)
    if (keys.length) await redis.del(...keys)
  } catch (err: any) {
    log?.warn(`[CascadeDelete] Falha ao limpar contadores Redis da conta (best-effort): ${err.message}`)
  }

  const pendentes = await prisma.message.findMany({ where: { apiClientId: clientId }, select: { id: true } })
  await removeQueuedJobs(pendentes.map((m) => m.id), log)

  // Ordem (por relação de FK): tentativas → mensagens → rotações → instâncias
  // (InstanceNumber cascateia) → webhooks → usuários → conta. Tudo atômico.
  // AuditLog (se `actor` informado) entra na MESMA transação — nunca escrita à parte.
  await prisma.$transaction([
    prisma.messageAttempt.deleteMany({ where: { message: { apiClientId: clientId } } }),
    prisma.message.deleteMany({ where: { apiClientId: clientId } }),
    prisma.campaign.deleteMany({ where: { apiClientId: clientId } }),
    prisma.numberRotation.deleteMany({ where: { instance: { apiClientId: clientId } } }),
    prisma.instance.deleteMany({ where: { apiClientId: clientId } }),
    prisma.webhook.deleteMany({ where: { apiClientId: clientId } }),
    prisma.user.deleteMany({ where: { apiClientId: clientId } }),
    prisma.apiClient.delete({ where: { id: clientId } }),
    ...(actor
      ? [auditLogEntry(actor, 'DELETE_CLIENT_CASCADE', 'ApiClient', client.id, clientSnapshot(client))]
      : []),
  ])

  return client
}
