// src/services/cascade-delete.service.test.ts
// cobre que deleteInstanceCascade/deleteClientCascade gravam o
// AuditLog na MESMA transação da deleção (mesmo array passado a
// prisma.$transaction) quando um `actor` é informado, e que o snapshot
// gravado NUNCA carrega segredo (token/webhookSecret/apiKey). Também cobre
// que, sem `actor` (chamadores fora de /admin/*), nenhum AuditLog é gravado
// — comportamento idêntico ao de antes desta feature.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  instance: { findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  apiClient: { findUnique: vi.fn(), delete: vi.fn() },
  message: { findMany: vi.fn(), deleteMany: vi.fn() },
  messageAttempt: { deleteMany: vi.fn() },
  numberRotation: { deleteMany: vi.fn() },
  campaign: { deleteMany: vi.fn() },
  webhook: { deleteMany: vi.fn() },
  user: { deleteMany: vi.fn() },
  auditLog: { create: vi.fn((args: any) => ({ __auditLogCreate: args })) },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

vi.mock('../utils/redis', () => ({
  redis: { del: vi.fn(), keys: vi.fn(async () => []) },
}))

vi.mock('../queues/send-message.queue', () => ({ removeSendJob: vi.fn() }))

import { deleteInstanceCascade, deleteClientCascade } from './cascade-delete.service'

const actor = { actorType: 'USER' as const, actorId: 'user1', actorLabel: 'super@example.com' }

function instanceFixture() {
  return {
    id: 'inst1',
    name: 'Vendas SP',
    slug: 'vendas-sp',
    phone: '5544999990000',
    label: 'Principal',
    provider: 'EVOLUTION',
    status: 'ACTIVE',
    apiClientId: 'client1',
    ownerUserId: null,
    instanceId: null, // sem sessão ativa no provider → cleanupProviders não chama nada
    token: 'tok_super_secreto',
    webhookSecret: 'whsec_super_secreto',
    numbers: [],
  }
}

function clientFixture() {
  return {
    id: 'client1',
    name: 'Acme',
    apiKey: 'ak_super_secreta',
    role: 'CLIENT',
    active: true,
    fallbackEnabled: false,
    rateLimit: 100,
    maxInstances: 1,
    maxPerRecipientPerHour: 10,
    totalSent: 42,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    instances: [],
  }
}

describe('deleteInstanceCascade — auditoria', () => {
  beforeEach(() => vi.clearAllMocks())

  it('com actor: grava AuditLog na MESMA transação da deleção, sem segredo no snapshot', async () => {
    const instance = instanceFixture()
    prismaMock.instance.findUnique.mockResolvedValueOnce(instance)
    prismaMock.message.findMany.mockResolvedValueOnce([])

    const result = await deleteInstanceCascade('inst1', undefined, actor)

    expect(result?.id).toBe('inst1')
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1)

    const call = prismaMock.auditLog.create.mock.calls[0][0]
    expect(call.data.actorType).toBe('USER')
    expect(call.data.actorId).toBe('user1')
    expect(call.data.action).toBe('DELETE_INSTANCE_CASCADE')
    expect(call.data.entityType).toBe('Instance')
    expect(call.data.entityId).toBe('inst1')
    expect(call.data.snapshot).not.toHaveProperty('token')
    expect(call.data.snapshot).not.toHaveProperty('webhookSecret')
    expect(call.data.snapshot).toMatchObject({ id: 'inst1', apiClientId: 'client1' })

    // A escrita do AuditLog entra no MESMO array passado a $transaction —
    // nunca uma escrita separada que possa ficar inconsistente com a deleção.
    const txOps = prismaMock.$transaction.mock.calls[0][0]
    expect(txOps).toHaveLength(5) // 4 deletes + 1 auditLog
    expect(txOps[4]).toEqual(prismaMock.auditLog.create.mock.results[0].value)
  })

  it('sem actor: NÃO grava AuditLog (comportamento idêntico ao de antes)', async () => {
    const instance = instanceFixture()
    prismaMock.instance.findUnique.mockResolvedValueOnce(instance)
    prismaMock.message.findMany.mockResolvedValueOnce([])

    await deleteInstanceCascade('inst1')

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
    const txOps = prismaMock.$transaction.mock.calls[0][0]
    expect(txOps).toHaveLength(4)
  })

  it('instância inexistente: retorna null e não toca a transação', async () => {
    prismaMock.instance.findUnique.mockResolvedValueOnce(null)

    const result = await deleteInstanceCascade('inst-inexistente', undefined, actor)

    expect(result).toBeNull()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
  })
})

describe('deleteClientCascade — auditoria', () => {
  beforeEach(() => vi.clearAllMocks())

  it('com actor: grava AuditLog na MESMA transação da deleção, sem apiKey no snapshot', async () => {
    const client = clientFixture()
    prismaMock.apiClient.findUnique.mockResolvedValueOnce(client)
    prismaMock.message.findMany.mockResolvedValueOnce([])

    const result = await deleteClientCascade('client1', undefined, actor)

    expect(result?.id).toBe('client1')
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1)

    const call = prismaMock.auditLog.create.mock.calls[0][0]
    expect(call.data.action).toBe('DELETE_CLIENT_CASCADE')
    expect(call.data.entityType).toBe('ApiClient')
    expect(call.data.entityId).toBe('client1')
    expect(call.data.snapshot).not.toHaveProperty('apiKey')
    expect(call.data.snapshot).toMatchObject({ id: 'client1', name: 'Acme' })

    const txOps = prismaMock.$transaction.mock.calls[0][0]
    expect(txOps).toHaveLength(9) // 8 deletes + 1 auditLog
    expect(txOps[8]).toEqual(prismaMock.auditLog.create.mock.results[0].value)
  })

  it('sem actor: NÃO grava AuditLog (comportamento idêntico ao de antes)', async () => {
    const client = clientFixture()
    prismaMock.apiClient.findUnique.mockResolvedValueOnce(client)
    prismaMock.message.findMany.mockResolvedValueOnce([])

    await deleteClientCascade('client1')

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
    const txOps = prismaMock.$transaction.mock.calls[0][0]
    expect(txOps).toHaveLength(8)
  })

  it('conta inexistente: retorna null e não toca a transação', async () => {
    prismaMock.apiClient.findUnique.mockResolvedValueOnce(null)

    const result = await deleteClientCascade('client-inexistente', undefined, actor)

    expect(result).toBeNull()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
  })
})
