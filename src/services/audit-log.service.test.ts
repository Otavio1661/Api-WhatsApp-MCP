// src/services/audit-log.service.test.ts
// resolveAuditActor precisa distinguir corretamente login humano
// (JWT, request.authUser) de acesso de máquina (API key, request.apiClient),
// e cair num fallback seguro se nenhum dos dois estiver presente (nunca
// deveria acontecer depois do guard authManage/requireSuperAdmin, mas não
// pode explodir se acontecer).
import { describe, it, expect, vi } from 'vitest'
import type { FastifyRequest } from 'fastify'

const prismaMock = vi.hoisted(() => ({
  auditLog: { create: vi.fn((args: any) => ({ __auditLogCreate: args })) },
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

import { resolveAuditActor, auditLogEntry } from './audit-log.service'

function fakeRequest(overrides: Partial<FastifyRequest>): FastifyRequest {
  return overrides as FastifyRequest
}

describe('resolveAuditActor', () => {
  it('login humano (JWT): usa authUser.id/email como ator', () => {
    const actor = resolveAuditActor(
      fakeRequest({ authUser: { id: 'u1', email: 'super@example.com', name: 'Super', role: 'SUPER_ADMIN' } }),
    )
    expect(actor).toEqual({ actorType: 'USER', actorId: 'u1', actorLabel: 'super@example.com' })
  })

  it('acesso de máquina (API key): usa apiClient.id/name como ator', () => {
    const actor = resolveAuditActor(
      fakeRequest({ apiClient: { id: 'client1', name: 'Conta ADMIN' } as any }),
    )
    expect(actor).toEqual({ actorType: 'API_KEY', actorId: 'client1', actorLabel: 'Conta ADMIN' })
  })

  it('sem authUser nem apiClient: fallback seguro (não lança)', () => {
    const actor = resolveAuditActor(fakeRequest({}))
    expect(actor).toEqual({ actorType: 'API_KEY', actorId: 'unknown', actorLabel: null })
  })
})

describe('auditLogEntry', () => {
  it('monta o create do AuditLog com os campos esperados, sem executar nada sozinho', () => {
    const actor = { actorType: 'USER' as const, actorId: 'u1', actorLabel: 'x@x.com' }
    auditLogEntry(actor, 'DELETE_USER', 'User', 'user1', { id: 'user1', email: 'x@x.com' })

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'USER',
        actorId: 'u1',
        actorLabel: 'x@x.com',
        action: 'DELETE_USER',
        entityType: 'User',
        entityId: 'user1',
        snapshot: { id: 'user1', email: 'x@x.com' },
      },
      select: { id: true },
    })
  })
})
