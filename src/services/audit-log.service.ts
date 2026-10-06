// src/services/audit-log.service.ts
// Auditoria estruturada das ações destrutivas do super admin.
// Ver prisma/schema.prisma (model AuditLog) para o porquê do desenho
// (sem FK pra actorId/entityId — a linha referenciada é apagada na MESMA
// transação que grava o registro).
//
// Uso: montar o Prisma.PrismaPromise com `auditLogEntry(...)` e empilhar
// junto dos deletes dentro do MESMO array passado a `prisma.$transaction`
// — nunca como escrita separada, que poderia ficar inconsistente se falhar
// depois do delete já ter sido commitado.
import type { FastifyRequest } from 'fastify'
import type { Prisma } from '@prisma/client'
import { prisma } from '../utils/prisma'

export interface AuditActor {
  actorType: 'API_KEY' | 'USER'
  actorId: string
  actorLabel: string | null
}

// Resolve quem está autenticado na request para carimbar o AuditLog.
// Chamar SOMENTE depois do guard authManage/requireSuperAdmin (mesmo guard
// das rotas /admin/* destrutivas) — antes disso request.apiClient/authUser
// podem não estar preenchidos de forma confiável.
export function resolveAuditActor(request: FastifyRequest): AuditActor {
  // Login humano (JWT/painel): o SUPER_ADMIN é a pessoa, não a conta.
  if (request.authUser) {
    return {
      actorType: 'USER',
      actorId: request.authUser.id,
      actorLabel: request.authUser.email,
    }
  }
  // Acesso de máquina (API key da conta ADMIN).
  return {
    actorType: 'API_KEY',
    actorId: request.apiClient?.id ?? 'unknown',
    actorLabel: request.apiClient?.name ?? null,
  }
}

// Monta a escrita do AuditLog para entrar no MESMO array de
// `prisma.$transaction([...])` da deleção — não executa nada sozinho.
export function auditLogEntry(
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string,
  snapshot: Record<string, unknown>,
): Prisma.PrismaPromise<{ id: string }> {
  return prisma.auditLog.create({
    data: {
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorLabel: actor.actorLabel,
      action,
      entityType,
      entityId,
      snapshot: snapshot as Prisma.InputJsonValue,
    },
    select: { id: true },
  })
}
