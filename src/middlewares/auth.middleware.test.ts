// src/middlewares/auth.middleware.test.ts
// Cobre o reaproveitamento de request.apiClient/instance já resolvidos por
// resolveTenantContext (onRequest) em authAccount/authInstance:
// antes, cada preHandler refazia a MESMA query ao Postgres incondicionalmente,
// dobrando round-trips no caminho mais quente. Aqui validamos que:
// - o preHandler NÃO reconsulta quando já vem resolvido pelo mesmo mecanismo;
// - a validação de erro (credencial ausente/inválida) continua intacta quando
//   resolveTenantContext não achou nada;
// - um token de instância resolvido no onRequest NUNCA é aceito como API key de
//   conta (e vice-versa) — evita bypass de auth via reuse indevido.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'

const prismaMock = vi.hoisted(() => ({
  apiClient: { findUnique: vi.fn(), findFirst: vi.fn() },
  instance: { findFirst: vi.fn() },
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

import { authAccount, authInstance } from './auth.middleware'

const TENANT_A = { id: 'tenant-A', apiKey: 'key-A', role: 'CLIENT', active: true }

function makeReply() {
  const reply = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code
      return reply
    },
    send(payload: unknown) {
      reply.body = payload
      return reply
    },
  }
  return reply as unknown as FastifyReply & { statusCode: number; body: unknown }
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    headers: {},
    params: {},
    ...overrides,
  } as unknown as FastifyRequest<{ Params?: { id?: string } }> & Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('authAccount — reuso de request.apiClient já resolvido', () => {
  it('reaproveita request.apiClient (setado por resolveTenantContext) sem reconsultar o Postgres', async () => {
    const request = makeRequest({ apiClient: TENANT_A })
    const reply = makeReply()

    await authAccount(request, reply)

    expect(prismaMock.apiClient.findFirst).not.toHaveBeenCalled()
    expect(request.apiClient).toBe(TENANT_A)
    expect(reply.statusCode).toBe(0) // não respondeu erro
  })

  it('NÃO reaproveita se o apiClient veio de um token de instância (request.instance setado) — evita aceitar token como API key', async () => {
    const request = makeRequest({
      apiClient: TENANT_A,
      instance: { id: 'inst-1', apiClientId: 'tenant-A' },
      headers: {}, // sem x-api-key/Authorization
    })
    const reply = makeReply()

    await authAccount(request, reply)

    // Sem apiKey no header, mesmo com request.apiClient já setado, deve exigir apiKey de novo.
    expect(reply.statusCode).toBe(401)
    expect(prismaMock.apiClient.findFirst).not.toHaveBeenCalled()
  })

  it('sem request.apiClient e sem header → 401 (mantém validação de erro), sem query', async () => {
    const request = makeRequest()
    const reply = makeReply()

    await authAccount(request, reply)

    expect(reply.statusCode).toBe(401)
    expect(reply.body).toEqual({ error: 'API key obrigatória' })
    expect(prismaMock.apiClient.findFirst).not.toHaveBeenCalled()
  })

  it('sem request.apiClient (resolveTenantContext não achou nada) mas com header válido → consulta e autentica', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    const request = makeRequest({ headers: { 'x-api-key': 'key-A' } })
    const reply = makeReply()

    await authAccount(request, reply)

    expect(prismaMock.apiClient.findFirst).toHaveBeenCalledTimes(1)
    expect(request.apiClient).toEqual(TENANT_A)
    expect(reply.statusCode).toBe(0)
  })

  it('sem request.apiClient e header com key inválida → 401, com query executada', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(null)
    const request = makeRequest({ headers: { 'x-api-key': 'key-invalida' } })
    const reply = makeReply()

    await authAccount(request, reply)

    expect(prismaMock.apiClient.findFirst).toHaveBeenCalledTimes(1)
    expect(reply.statusCode).toBe(401)
  })
})

describe('authInstance — reuso de request.instance/apiClient já resolvidos', () => {
  const INSTANCE_DATA = { id: 'inst-1', apiClientId: 'tenant-A' }

  it('reaproveita request.instance/apiClient já resolvidos sem reconsultar o Postgres', async () => {
    const request = makeRequest({ instance: INSTANCE_DATA, apiClient: TENANT_A })
    const reply = makeReply()

    await authInstance(request, reply)

    expect(prismaMock.instance.findFirst).not.toHaveBeenCalled()
    expect(request.instance).toBe(INSTANCE_DATA)
    expect(reply.statusCode).toBe(0)
  })

  it('reuso ainda valida o :id da rota contra a instância (não pula a checagem de segurança)', async () => {
    const request = makeRequest({
      instance: INSTANCE_DATA,
      apiClient: TENANT_A,
      params: { id: 'outro-id' },
    })
    const reply = makeReply()

    await authInstance(request, reply)

    expect(prismaMock.instance.findFirst).not.toHaveBeenCalled()
    expect(reply.statusCode).toBe(401)
    expect(reply.body).toEqual({ error: 'Token não corresponde à instância informada' })
  })

  it('NÃO reaproveita se só request.apiClient veio setado (resolvido por API key, sem token) — exige token de novo', async () => {
    const request = makeRequest({ apiClient: TENANT_A, headers: {} })
    const reply = makeReply()

    await authInstance(request, reply)

    expect(reply.statusCode).toBe(401)
    expect(reply.body).toEqual({ error: 'Token de instância obrigatório' })
    expect(prismaMock.instance.findFirst).not.toHaveBeenCalled()
  })

  it('sem request.instance/apiClient e sem header → 401, sem query', async () => {
    const request = makeRequest()
    const reply = makeReply()

    await authInstance(request, reply)

    expect(reply.statusCode).toBe(401)
    expect(reply.body).toEqual({ error: 'Token de instância obrigatório' })
    expect(prismaMock.instance.findFirst).not.toHaveBeenCalled()
  })

  it('sem reuse disponível mas com token válido no header → consulta e autentica', async () => {
    prismaMock.instance.findFirst.mockResolvedValue({ ...INSTANCE_DATA, apiClient: TENANT_A })
    const request = makeRequest({ headers: { token: 'tok-123' } })
    const reply = makeReply()

    await authInstance(request, reply)

    expect(prismaMock.instance.findFirst).toHaveBeenCalledTimes(1)
    expect(request.instance).toEqual(INSTANCE_DATA)
    expect(request.apiClient).toEqual(TENANT_A)
    expect(reply.statusCode).toBe(0)
  })

  it('sem reuse disponível e token inválido → 401, com query executada', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(null)
    const request = makeRequest({ headers: { token: 'tok-invalido' } })
    const reply = makeReply()

    await authInstance(request, reply)

    expect(prismaMock.instance.findFirst).toHaveBeenCalledTimes(1)
    expect(reply.statusCode).toBe(401)
  })
})
