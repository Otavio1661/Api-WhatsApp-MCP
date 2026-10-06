// src/services/provisioning.service.test.ts
// Testa o tratamento da corrida (TOCTOU) na unicidade de e-mail:
// quando o pré-check passa mas o insert bate no @unique (P2002), o serviço deve
// relançar ProvisioningError('EMAIL_TAKEN') — e não vazar o erro do Prisma (500).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const prismaMock = vi.hoisted(() => ({
  apiClient: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  user: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  auditLog: { create: vi.fn((args: any) => ({ __auditLogCreate: args })) },
  $transaction: vi.fn(),
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

vi.mock('../utils/password', () => ({ hashPassword: vi.fn(async () => 'hash') }))

import {
  createClientWithOwner,
  createUserForClient,
  deleteUser,
  listClientsPaged,
  listUsersPaged,
  ProvisioningError,
} from './provisioning.service'

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  })
}

describe('createClientWithOwner — TOCTOU de e-mail (P2002)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('relança P2002 como ProvisioningError(EMAIL_TAKEN)', async () => {
    // Pré-check passa (e-mail livre no momento da leitura)...
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    // ...mas a transação falha no insert por corrida (P2002).
    prismaMock.$transaction.mockRejectedValueOnce(p2002())

    await expect(
      createClientWithOwner({
        name: 'Acme',
        role: 'CLIENT',
        fallbackEnabled: false,
        rateLimit: 100,
        ownerEmail: 'dup@x.com',
        ownerPassword: 'senha12345',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' })
  })

  it('propaga erros não-P2002 sem mascarar', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    prismaMock.$transaction.mockRejectedValueOnce(new Error('db down'))

    await expect(
      createClientWithOwner({
        name: 'Acme',
        role: 'CLIENT',
        fallbackEnabled: false,
        rateLimit: 100,
        ownerEmail: 'x@x.com',
        ownerPassword: 'senha12345',
      }),
    ).rejects.toThrow('db down')
  })
})

describe('createUserForClient — TOCTOU de e-mail (P2002)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('relança P2002 como ProvisioningError(EMAIL_TAKEN)', async () => {
    prismaMock.apiClient.findUnique.mockResolvedValueOnce({ id: 'tenant-1' })
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    prismaMock.user.create.mockRejectedValueOnce(p2002())

    const err = await createUserForClient({
      apiClientId: 'tenant-1',
      email: 'dup@x.com',
      password: 'senha12345',
      role: 'MEMBER',
    }).catch((e) => e)

    expect(err).toBeInstanceOf(ProvisioningError)
    expect(err.code).toBe('EMAIL_TAKEN')
  })
})

// deleteUser (usado por DELETE /admin/users/:id) precisa gravar o
// AuditLog na MESMA transação da deleção quando um `actor` é informado, sem
// vazar passwordHash no snapshot — e continuar 100% compatível (sem AuditLog)
// para os demais chamadores (account.route.ts/panel.route.ts), que não passam actor.
describe('deleteUser — auditoria', () => {
  beforeEach(() => vi.clearAllMocks())

  const actor = { actorType: 'API_KEY' as const, actorId: 'client-admin', actorLabel: 'Conta ADMIN' }

  function userFixture() {
    return {
      id: 'user1',
      email: 'foo@acme.com',
      passwordHash: '$2b$super-hash-secreto',
      name: 'Foo',
      role: 'MEMBER',
      apiClientId: 'client1',
      emailVerified: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }
  }

  it('com actor: grava AuditLog na MESMA transação, sem passwordHash no snapshot', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(userFixture())
    prismaMock.$transaction.mockImplementationOnce(async (ops: unknown[]) => Promise.all(ops))

    const removed = await deleteUser('user1', actor)

    expect(removed).toBe(true)
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1)
    const call = prismaMock.auditLog.create.mock.calls[0][0]
    expect(call.data.action).toBe('DELETE_USER')
    expect(call.data.entityType).toBe('User')
    expect(call.data.entityId).toBe('user1')
    expect(call.data.snapshot).not.toHaveProperty('passwordHash')
    expect(call.data.snapshot).toMatchObject({ id: 'user1', email: 'foo@acme.com' })

    const txOps = prismaMock.$transaction.mock.calls[0][0]
    expect(txOps).toHaveLength(2) // delete + auditLog
  })

  it('sem actor: NÃO grava AuditLog (mantém compatibilidade com os demais chamadores)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(userFixture())
    prismaMock.$transaction.mockImplementationOnce(async (ops: unknown[]) => Promise.all(ops))

    const removed = await deleteUser('user1')

    expect(removed).toBe(true)
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
    const txOps = prismaMock.$transaction.mock.calls[0][0]
    expect(txOps).toHaveLength(1)
  })

  it('usuário inexistente: retorna false e não toca a transação', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)

    const removed = await deleteUser('user-inexistente', actor)

    expect(removed).toBe(false)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
  })
})

describe('listClientsPaged / listUsersPaged — paginação (skip/take + count)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listClientsPaged usa page/limit default (1/20) quando nada é passado', async () => {
    prismaMock.apiClient.findMany.mockResolvedValueOnce([])
    prismaMock.apiClient.count.mockResolvedValueOnce(0)

    const result = await listClientsPaged()

    expect(prismaMock.apiClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    )
    expect(result).toEqual({ data: [], page: 1, limit: 20, total: 0 })
  })

  it('listClientsPaged calcula skip a partir da página pedida e limita o teto em 100', async () => {
    prismaMock.apiClient.findMany.mockResolvedValueOnce([{ id: 'c1' }])
    prismaMock.apiClient.count.mockResolvedValueOnce(250)

    const result = await listClientsPaged({ page: 3, limit: 500 })

    expect(prismaMock.apiClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 200, take: 100 }),
    )
    expect(result).toEqual({ data: [{ id: 'c1' }], page: 3, limit: 100, total: 250 })
  })

  it('listClientsPaged nunca deixa a página cair abaixo de 1', async () => {
    prismaMock.apiClient.findMany.mockResolvedValueOnce([])
    prismaMock.apiClient.count.mockResolvedValueOnce(0)

    await listClientsPaged({ page: -5 })

    expect(prismaMock.apiClient.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }))
  })

  it('listUsersPaged filtra por apiClientId (conta) quando informado, no where E no count', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'u1' }])
    prismaMock.user.count.mockResolvedValueOnce(1)

    const result = await listUsersPaged('tenant-1', { page: 2, limit: 10 })

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { apiClientId: 'tenant-1' }, skip: 10, take: 10 }),
    )
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where: { apiClientId: 'tenant-1' } })
    expect(result).toEqual({ data: [{ id: 'u1' }], page: 2, limit: 10, total: 1 })
  })

  it('listUsersPaged sem apiClientId busca todas as contas (where undefined)', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([])
    prismaMock.user.count.mockResolvedValueOnce(0)

    await listUsersPaged(undefined, { page: 1 })

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }))
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where: undefined })
  })
})
