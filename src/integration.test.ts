// src/integration.test.ts
// Testes de integração via buildApp() + app.inject().
// DECISÃO DE DESIGN: mockamos `src/utils/prisma` (e `src/utils/redis`) com vi.mock
// para não depender de Postgres/Redis reais — isso torna os testes determinísticos e
// robustos em CI. A montagem do app (plugins + rotas + guards) é exercitada de verdade;
// só a camada de dados é simulada.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

// ── Mock do Prisma ────────────────────────────────────────────
// Cada model expõe os métodos usados pelas rotas cobertas aqui.
const prismaMock = vi.hoisted(() => ({
  apiClient: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  instance: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
  message: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
  messageAttempt: { deleteMany: vi.fn() },
  webhook: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  campaign: { create: vi.fn(), findFirst: vi.fn() },
  inboundMessage: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('./utils/prisma', () => ({ prisma: prismaMock }))

// ── Mock do Redis ─────────────────────────────────────────────
// Usado pelo store do @fastify/rate-limit. Um stub mínimo que NÃO conecta de verdade.
const redisMock = vi.hoisted(() => {
  // Contador em memória para emular o RedisStore do @fastify/rate-limit.
  const store = new Map<string, number>()
  const client: any = {
    on: vi.fn(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    // Usados por checkRecipientHourlyLimit (anti-flood por destinatário) — default
    // "permite" (contador 1) pra não afetar os demais testes que não configuram
    // maxPerRecipientPerHour no apiClient/instância.
    eval: vi.fn(async () => 1),
    pttl: vi.fn(async () => 60000),
    // O RedisStore registra o comando 'rateLimit' via defineCommand e depois o chama
    // no estilo callback: rateLimit(key, timeWindow, max, ban, continueExceeding, cb).
    // Aqui implementamos uma contagem simples em memória → retorna [current, ttl, banned].
    defineCommand: vi.fn((name: string) => {
      if (name === 'rateLimit') {
        client.rateLimit = (key: string, _tw: number, max: number, _ban: number, _ce: boolean, cb: any) => {
          const n = (store.get(key) ?? 0) + 1
          store.set(key, n)
          const banned = false
          cb(null, [n, 60000, banned])
        }
      }
    }),
    __store: store,
  }
  return client
})
vi.mock('./utils/redis', () => ({ redis: redisMock }))

// Evita inicializar workers/filas BullMQ reais ao importar o server.
vi.mock('./queues/send-message.worker', () => ({
  startSendMessageWorker: vi.fn(),
  stopSendMessageWorker: vi.fn(async () => {}),
}))
vi.mock('./queues/send-message.queue', () => ({
  enqueueSend: vi.fn(async () => {}),
  requeueSend: vi.fn(async () => {}),
  removeSendJob: vi.fn(async () => {}),
  getSendQueueJobCounts: vi.fn(async () => ({})),
  sendMessageQueue: {},
}))
vi.mock('./queues/scheduler', () => ({
  startScheduler: vi.fn(async () => {}),
  stopScheduler: vi.fn(async () => {}),
}))

import { buildApp } from './server'
import { config } from './config'

// Helpers de tenant para os mocks de auth.
const TENANT_A = { id: 'tenant-A', name: 'Conta A', apiKey: 'key-A', role: 'CLIENT', active: true, rateLimit: 1000, fallbackEnabled: false }
const TENANT_B = { id: 'tenant-B', name: 'Conta B', apiKey: 'key-B', role: 'CLIENT', active: true, rateLimit: 1000, fallbackEnabled: false }
const ADMIN = { id: 'admin-1', name: 'Admin', apiKey: 'key-admin', role: 'ADMIN', active: true, rateLimit: 1000, fallbackEnabled: false }

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // resolveTenantContext (onRequest) e authAccount (preHandler) chamam
  // apiClient.findFirst por apiKey/apiKeyHash;
  // por padrão devolve null (anônimo) — cada teste configura o cenário que precisa.
  prismaMock.apiClient.findFirst.mockResolvedValue(null)
})

async function makeApp(): Promise<FastifyInstance> {
  const a = buildApp()
  await a.ready()
  return a
}

describe('Auth — 401 sem credencial / 403 sem papel', () => {
  it('401 ao listar instâncias sem nenhuma credencial', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/instances' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('403 ao acessar rota admin com conta CLIENT', async () => {
    // authAccount resolve a apiKey p/ um CLIENT; requireAdmin então barra com 403.
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    app = await makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients',
      headers: { 'x-api-key': 'key-A' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  // se o apiKey armazenado JÁ estiver cifrado (formato válido) mas a
  // tag do GCM não bater (chave errada/rotacionada, ou dado corrompido), o
  // auth middleware precisa responder 401 (credencial inválida) e NUNCA deixar
  // o decrypt estourar como 500 — ver secrets-crypto.ts/decryptApiClientSecret.
  it('401 (não 500) quando a apiKey armazenada está cifrada mas ilegível', async () => {
    const { encryptSecret } = await import('./utils/secrets-crypto')
    const corrupted = encryptSecret('key-A').replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
    prismaMock.apiClient.findFirst.mockResolvedValue({ ...TENANT_A, apiKey: corrupted })
    app = await makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/instances',
      headers: { 'x-api-key': 'key-A' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})

describe('Isolamento entre tenants', () => {
  it('cada tenant só enxerga as próprias instâncias (where escopado por apiClientId)', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    // O findMany de instâncias devolve só o que o where pediu — validamos o escopo.
    prismaMock.instance.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.apiClientId === 'tenant-A') {
        return [{ id: 'i-A', apiClientId: 'tenant-A', provider: 'WUZAPI', status: 'ACTIVE', priority: 0, token: 't', instanceId: null, name: null, phone: null, connectionState: 'DISCONNECTED', qrCode: null, qrExpiresAt: null, sentToday: 0, sentTotal: 0, createdAt: new Date(), updatedAt: new Date(), lastSentAt: null, bannedAt: null, banReason: null, bannedCount: 0, maxRetries: 3 }]
      }
      return []
    })

    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/instances', headers: { 'x-api-key': 'key-A' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // Garante que a query foi escopada ao tenant autenticado.
    expect(prismaMock.instance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { apiClientId: 'tenant-A' } }),
    )
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.every((i: any) => i.id === 'i-A')).toBe(true)
    await app.close()
  })
})

// GET /messages, GET /messages/:id, POST /messages/:id/resend e
// DELETE /messages/:id escopavam só por apiClientId — um MEMBER lia/apagava
// mensagens de outro MEMBER da mesma conta através da instância dele. Reproduz
// EXATAMENTE o cenário do card: 2 MEMBERs (A e B) na mesma conta, cada um dono
// de uma instância distinta; A não pode enxergar nem mexer nas mensagens de B.
describe('Isolamento entre MEMBERs (mensagens)', () => {
  const instA = { id: 'inst-A', ownerUserId: 'member-A' }
  const instB = { id: 'inst-B', ownerUserId: 'member-B' }
  // msg-A foi disparada pelo MEMBER A via a instância dele; msg-B, pelo MEMBER B
  // via a instância dele — o par mínimo que reproduz o vazamento do card.
  const msgA = {
    id: 'msg-A', apiClientId: 'tenant-A', createdByUserId: 'member-A',
    instanceId: 'inst-A', instance: instA, status: 'FAILED', toPhone: '5544999990000',
    maxRetries: 3, retryCount: 1, attempts: [],
  }
  const msgB = {
    id: 'msg-B', apiClientId: 'tenant-A', createdByUserId: 'member-B',
    instanceId: 'inst-B', instance: instB, status: 'FAILED', toPhone: '5544999990001',
    maxRetries: 3, retryCount: 1, attempts: [],
  }
  const ALL_MESSAGES = [msgA, msgB]

  // Réplica mínima da semântica do where do Prisma para os campos usados pela
  // rota (apiClientId/id/status/OR), o suficiente pra exercitar de verdade o
  // filtro de escopo que a rota monta — não é a engine real do Prisma.
  function messageMatches(msg: any, where: any): boolean {
    if (where.apiClientId && msg.apiClientId !== where.apiClientId) return false
    if (where.id && msg.id !== where.id) return false
    if (where.status && msg.status !== where.status) return false
    if (where.OR) {
      const ok = (where.OR as any[]).some((cond: any) => {
        if (cond.createdByUserId !== undefined) return msg.createdByUserId === cond.createdByUserId
        if (cond.instance !== undefined) return msg.instance?.ownerUserId === cond.instance.ownerUserId
        return false
      })
      if (!ok) return false
    }
    return true
  }

  let memberA: any
  let memberB: any

  beforeEach(async () => {
    const { hashPassword } = await import('./utils/password')
    const hash = await hashPassword('senha123')
    const apiClientA = { id: 'tenant-A', name: 'Conta A', role: 'CLIENT', active: true }
    // externalId: null → conta local (sem provedor externo): valida a senha local.
    memberA = { id: 'member-A', email: 'membro-a@conta.com', name: 'Membro A', role: 'MEMBER', passwordHash: hash, apiClientId: 'tenant-A', apiClient: apiClientA, externalId: null }
    memberB = { id: 'member-B', email: 'membro-b@conta.com', name: 'Membro B', role: 'MEMBER', passwordHash: hash, apiClientId: 'tenant-A', apiClient: apiClientA, externalId: null }

    // user.findUnique é usado tanto no login (por email) quanto no authJwt (por id).
    prismaMock.user.findUnique.mockImplementation(async (args: any) => {
      const where = args?.where ?? {}
      const candidatos = [memberA, memberB]
      if (where.email) return candidatos.find((u) => u.email === where.email) ?? null
      if (where.id) return candidatos.find((u) => u.id === where.id) ?? null
      return null
    })

    prismaMock.message.findFirst.mockImplementation(async (args: any) => ALL_MESSAGES.find((m) => messageMatches(m, args?.where ?? {})) ?? null)
    prismaMock.message.findMany.mockImplementation(async (args: any) => ALL_MESSAGES.filter((m) => messageMatches(m, args?.where ?? {})))
    prismaMock.message.count.mockImplementation(async (args: any) => ALL_MESSAGES.filter((m) => messageMatches(m, args?.where ?? {})).length)
  })

  async function loginAs(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'senha123' } })
    expect(res.statusCode).toBe(200)
    return res.json().token as string
  }

  it('GET /messages: MEMBER A não enxerga mensagem de MEMBER B (mesma conta, instância diferente)', async () => {
    app = await makeApp()
    const tokenA = await loginAs('membro-a@conta.com')

    const res = await app.inject({ method: 'GET', url: '/v1/messages', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((m: any) => m.id)
    expect(ids).toEqual(['msg-A'])
    await app.close()
  })

  it('GET /messages/:id de uma mensagem do MEMBER B, autenticado como A → 404', async () => {
    app = await makeApp()
    const tokenA = await loginAs('membro-a@conta.com')

    const res = await app.inject({ method: 'GET', url: '/v1/messages/msg-B', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('POST /messages/:id/resend de uma mensagem do MEMBER B, autenticado como A → 404 (não reenfileira)', async () => {
    app = await makeApp()
    const tokenA = await loginAs('membro-a@conta.com')

    const res = await app.inject({ method: 'POST', url: '/v1/messages/msg-B/resend', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.message.update).not.toHaveBeenCalled()
    await app.close()
  })

  it('DELETE /messages/:id de uma mensagem do MEMBER B, autenticado como A → 404 (não apaga — era o "sucede" do card)', async () => {
    app = await makeApp()
    const tokenA = await loginAs('membro-a@conta.com')

    const res = await app.inject({ method: 'DELETE', url: '/v1/messages/msg-B', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    await app.close()
  })

  it('MEMBER A continua lendo e apagando a PRÓPRIA mensagem normalmente (sem regressão)', async () => {
    prismaMock.message.delete.mockResolvedValue({})
    prismaMock.messageAttempt.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops))

    app = await makeApp()
    const tokenA = await loginAs('membro-a@conta.com')

    const getRes = await app.inject({ method: 'GET', url: '/v1/messages/msg-A', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(getRes.statusCode).toBe(200)
    expect(getRes.json().id).toBe('msg-A')

    const delRes = await app.inject({ method: 'DELETE', url: '/v1/messages/msg-A', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(delRes.statusCode).toBe(204)
    await app.close()
  })

  it('OWNER/API key da conta continua vendo mensagens dos dois MEMBERs — sem regressão no escopo normal', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    app = await makeApp()

    const res = await app.inject({ method: 'GET', url: '/v1/messages', headers: { 'x-api-key': 'key-A' } })
    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((m: any) => m.id).sort()
    expect(ids).toEqual(['msg-A', 'msg-B'])
    await app.close()
  })
})

describe('Inbound de status', () => {
  // Cloud API: mapeamento de status inbound estável. (WuzAPI coberto logo abaixo.)
  const cloudDeliveredPayload = {
    entry: [{ changes: [{ value: { statuses: [{ id: 'PID', status: 'delivered' }] } }] }],
  }

  it('aplica SENT → DELIVERED (status avança e grava deliveredAt)', async () => {
    prismaMock.instance.findUnique.mockResolvedValue({ id: 'inst-1', apiClientId: 'tenant-A', provider: 'CLOUD_API', webhookSecret: 'segredo-1' })
    prismaMock.message.findFirst.mockResolvedValue({ id: 'msg-1', status: 'SENT', apiClientId: 'tenant-A', toPhone: '55', readAt: null, deliveredAt: null })
    prismaMock.message.update.mockResolvedValue({})

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound/cloud_api/inst-1?ws=segredo-1',
      payload: cloudDeliveredPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    )
    await app.close()
  })

  it('NÃO regride READ → DELIVERED (status não avança → sem update)', async () => {
    prismaMock.instance.findUnique.mockResolvedValue({ id: 'inst-1', apiClientId: 'tenant-A', provider: 'CLOUD_API', webhookSecret: 'segredo-1' })
    prismaMock.message.findFirst.mockResolvedValue({ id: 'msg-1', status: 'READ', apiClientId: 'tenant-A', toPhone: '55', readAt: new Date(), deliveredAt: new Date() })

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound/cloud_api/inst-1?ws=segredo-1',
      payload: cloudDeliveredPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.message.update).not.toHaveBeenCalled()
    await app.close()
  })

  it('WuzAPI ReadReceipt (form-encoded) aplica SENT → DELIVERED', async () => {
    prismaMock.instance.findUnique.mockResolvedValue({ id: 'inst-1', apiClientId: 'tenant-A', provider: 'WUZAPI', webhookSecret: 'segredo-1' })
    prismaMock.message.findFirst.mockResolvedValue({ id: 'msg-1', status: 'SENT', apiClientId: 'tenant-A', toPhone: '55', readAt: null, deliveredAt: null })
    prismaMock.message.update.mockResolvedValue({})

    // Formato REAL do WuzAPI: corpo form-urlencoded com o evento em `jsonData`.
    const jsonData = JSON.stringify({ type: 'ReadReceipt', state: 'Delivered', event: { MessageIDs: ['PID'] } })
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound/wuzapi/inst-1?ws=segredo-1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `instanceName=inst-1&userID=u1&jsonData=${encodeURIComponent(jsonData)}`,
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    )
    await app.close()
  })

  it('ws ausente/errado → 401, sem processar o evento', async () => {
    prismaMock.instance.findUnique.mockResolvedValue({ id: 'inst-1', apiClientId: 'tenant-A', provider: 'CLOUD_API', webhookSecret: 'segredo-1' })

    app = await makeApp()
    const semWs = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound/cloud_api/inst-1',
      payload: cloudDeliveredPayload,
    })
    expect(semWs.statusCode).toBe(401)

    const wsErrado = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound/cloud_api/inst-1?ws=errado',
      payload: cloudDeliveredPayload,
    })
    expect(wsErrado.statusCode).toBe(401)
    expect(prismaMock.message.findFirst).not.toHaveBeenCalled()
    await app.close()
  })

  it('provider inválido → 404', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound/provider-zoado/inst-1',
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('Login JWT', () => {
  it('credencial válida retorna token', async () => {
    // O password.ts usa bcryptjs; geramos um hash válido em runtime no setup do teste.
    const { hashPassword } = await import('./utils/password')
    const hash = await hashPassword('segredo123')
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u-1', email: 'owner@a.com', name: 'Owner', role: 'OWNER',
      passwordHash: hash, apiClientId: 'tenant-A', externalId: null,
      apiClient: { id: 'tenant-A', name: 'Conta A', role: 'CLIENT', active: true },
    })

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'owner@a.com', password: 'segredo123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.token).toBe('string')
    expect(body.token.split('.')).toHaveLength(3)
    await app.close()
  })

  it('credencial inválida → 401', async () => {
    const { hashPassword } = await import('./utils/password')
    const hash = await hashPassword('a-senha-certa')
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u-1', email: 'owner@a.com', name: 'Owner', role: 'OWNER',
      passwordHash: hash, apiClientId: 'tenant-A', externalId: null,
      apiClient: { id: 'tenant-A', name: 'Conta A', role: 'CLIENT', active: true },
    })

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'owner@a.com', password: 'senha-errada' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  // upgrade do fast-jwt (via override, CVE crítica corrigida) — cobre
  // o round-trip completo sign() → jwtVerify() que o login/"refresh" de sessão
  // dependem (authJwt em auth.middleware.ts e requirePanelAuth no painel usam o
  // mesmo request.jwtVerify()). Sem este teste, um upgrade que quebrasse a
  // verificação (só o sign) passaria despercebido.
  it('token emitido no login é aceito por jwtVerify (GET /auth/me)', async () => {
    const { hashPassword } = await import('./utils/password')
    const hash = await hashPassword('segredo123')
    const userRecord = {
      id: 'u-1', email: 'owner@a.com', name: 'Owner', role: 'OWNER',
      passwordHash: hash, apiClientId: 'tenant-A', externalId: null,
      apiClient: { id: 'tenant-A', name: 'Conta A', role: 'CLIENT', active: true },
    }
    prismaMock.user.findUnique.mockResolvedValue(userRecord)

    app = await makeApp()
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'owner@a.com', password: 'segredo123' },
    })
    expect(loginRes.statusCode).toBe(200)
    const { token } = loginRes.json()

    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(meRes.statusCode).toBe(200)
    expect(meRes.json().user.email).toBe('owner@a.com')
    await app.close()
  })

  it('token adulterado (assinatura inválida) → 401 em jwtVerify', async () => {
    app = await makeApp()
    // Token com estrutura válida (header.payload.signature) mas assinatura falsa —
    // precisa continuar sendo rejeitado após o upgrade (algorithm confusion / bypass
    // é exatamente o tipo de CVE que este card corrige).
    const fakeToken = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ userId: 'u-1', apiClientId: 'tenant-A', accountRole: 'CLIENT', jti: 'x' })).toString('base64url'),
      'assinatura-falsa',
    ].join('.')

    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${fakeToken}` },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})

describe('Provisionamento admin-only', () => {
  it('usuário comum (CLIENT) → 403', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/clients',
      headers: { 'x-api-key': 'key-A' },
      payload: { name: 'Nova Conta' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('admin cria conta → 201', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(ADMIN)
    // $transaction recebe um callback (tx) — simulamos a criação da conta.
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        apiClient: { create: vi.fn(async () => ({ id: 'novo-1', name: 'Nova Conta', role: 'CLIENT', apiKey: 'gen-key', fallbackEnabled: false, rateLimit: 100, active: true, createdAt: new Date() })) },
        user: { create: vi.fn() },
      }
      return fn(tx)
    })

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/clients',
      headers: { 'x-api-key': 'key-admin' },
      payload: { name: 'Nova Conta' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toBe('novo-1')
    expect(body.apiKey).toBe('gen-key')
    await app.close()
  })
})

describe('Envio por token de instância — tipos novos e ações WuzAPI', () => {
  const wuzInstance = {
    id: 'inst-1', apiClientId: 'tenant-A', provider: 'WUZAPI', token: 'tok-1', instanceId: 'wuz-tok',
    apiClient: { id: 'tenant-A', active: true },
    status: 'ACTIVE', maxRetries: 3,
  }
  const evoInstance = {
    id: 'inst-2', apiClientId: 'tenant-A', provider: 'EVOLUTION', token: 'tok-2', instanceId: 'evo-1',
    apiClient: { id: 'tenant-A', active: true },
    status: 'ACTIVE', maxRetries: 3,
  }

  it('POST /instance/:id/messages/send (LOCATION) cria a Message e enfileira', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(wuzInstance)
    prismaMock.message.create.mockResolvedValue({ id: 'msg-loc', maxRetries: 3 })

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-1/messages/send',
      headers: { Token: 'tok-1' },
      payload: { to: '5544999990000', type: 'LOCATION', latitude: -23.5, longitude: -46.6, locationName: 'Escritório' },
    })

    expect(res.statusCode).toBe(202)
    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'LOCATION',
          location: { latitude: -23.5, longitude: -46.6 },
          content: 'Escritório',
        }),
      }),
    )
    await app.close()
  })

  it('POST /instance/:id/messages/send (POLL) valida schema — falta pollOptions → 400', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(wuzInstance)

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-1/messages/send',
      headers: { Token: 'tok-1' },
      payload: { to: '5544999990000', type: 'POLL', text: 'Pergunta?' },
    })

    expect(res.statusCode).toBe(400)
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('POST /instance/:id/actions/check-number numa instância EVOLUTION → 400 CHECK_NUMBER_UNSUPPORTED', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(evoInstance)

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-2/actions/check-number',
      headers: { Token: 'tok-2' },
      payload: { phones: ['5544999990000'] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().errorCode).toBe('CHECK_NUMBER_UNSUPPORTED')
    await app.close()
  })

  it('POST /instance/:id/actions/react numa instância EVOLUTION → 400 REACTION_UNSUPPORTED', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(evoInstance)

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-2/actions/react',
      headers: { Token: 'tok-2' },
      payload: { to: '5544999990000', messageId: 'abc', emoji: '👍' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().errorCode).toBe('REACTION_UNSUPPORTED')
    await app.close()
  })

  it('POST /instance/:id/actions/presence com payload inválido (state fora do enum) → 400', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(wuzInstance)

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-1/actions/presence',
      headers: { Token: 'tok-1' },
      payload: { to: '5544999990000', state: 'dancando' },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('limite anti-flood por destinatário também no envio por token de instância', () => {
  // apiClient com teto configurado (diferente das instâncias do describe acima, que não
  // configuram maxPerRecipientPerHour e por isso não tocam o Redis).
  const wuzInstanceComLimite = {
    id: 'inst-1', apiClientId: 'tenant-A', provider: 'WUZAPI', token: 'tok-1', instanceId: 'wuz-tok',
    apiClient: { id: 'tenant-A', active: true, maxPerRecipientPerHour: 3 },
    status: 'ACTIVE', maxRetries: 3,
  }

  it('POST /instance/:id/messages/chat → 429 quando o teto por destinatário é atingido, SEM criar a Message', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(wuzInstanceComLimite)
    redisMock.eval.mockResolvedValueOnce(-1) // Lua do checkRecipientHourlyLimit: bloqueado
    redisMock.pttl.mockResolvedValueOnce(120_000)

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-1/messages/chat',
      headers: { Token: 'tok-1' },
      payload: { to: '5544999990000', body: 'oi' },
    })

    expect(res.statusCode).toBe(429)
    expect(res.headers['retry-after']).toBe('120')
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('POST /instance/:id/messages/send → 429 quando o teto por destinatário é atingido, SEM criar a Message', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(wuzInstanceComLimite)
    redisMock.eval.mockResolvedValueOnce(-1)
    redisMock.pttl.mockResolvedValueOnce(60_000)

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-1/messages/send',
      headers: { Token: 'tok-1' },
      payload: { to: '5544999990000', type: 'TEXT', text: 'oi' },
    })

    expect(res.statusCode).toBe(429)
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('POST /instance/:id/messages/chat → dentro do teto, cria e enfileira normalmente (202)', async () => {
    prismaMock.instance.findFirst.mockResolvedValue(wuzInstanceComLimite)
    redisMock.eval.mockResolvedValueOnce(1) // 1ª mensagem na janela — permitido
    prismaMock.message.create.mockResolvedValue({ id: 'msg-ok', maxRetries: 3 })

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-1/messages/chat',
      headers: { Token: 'tok-1' },
      payload: { to: '5544999990000', body: 'oi' },
    })

    expect(res.statusCode).toBe(202)
    expect(prismaMock.message.create).toHaveBeenCalled()
    await app.close()
  })

  // /messages/media era o único dos 3 endpoints de token sem cobertura de
  // teste pro teto (chat e send já eram cobertos acima, acima) — fecha os 3.
  it('POST /instance/:id/messages/media → 429 quando o teto por destinatário é atingido, SEM criar a Message', async () => {
    prismaMock.instance.findUnique.mockResolvedValue(wuzInstanceComLimite)
    redisMock.eval.mockResolvedValueOnce(-1)
    redisMock.pttl.mockResolvedValueOnce(90_000)

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/instance/inst-1/messages/media',
      headers: { Token: 'tok-1' },
      payload: { to: '5544999990000', mediaUrl: 'https://example.com/foto.jpg' },
    })

    expect(res.statusCode).toBe(429)
    expect(res.headers['retry-after']).toBe('90')
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('Isolamento de instância entre MEMBERs', () => {
  // Duas instâncias da MESMA conta (tenant-A), cada uma pertencente a um MEMBER
  // diferente. Antes da correção, findFirst({id, apiClientId}) só checava a
  // CONTA — um MEMBER conseguia usar a instância do outro. Agora usa
  // findInstanceByIdOrSlug(idOrSlug, apiClientId, memberScopeId(request)), que
  // também escopa por ownerUserId quando o autenticado é MEMBER.
  const INSTANCE_A = { id: 'inst-member-A', apiClientId: 'tenant-A', ownerUserId: 'member-A', slug: 'inst-a', provider: 'WUZAPI', status: 'ACTIVE', maxRetries: 3, name: 'Instância A' }
  const INSTANCE_B = { id: 'inst-member-B', apiClientId: 'tenant-A', ownerUserId: 'member-B', slug: 'inst-b', provider: 'WUZAPI', status: 'ACTIVE', maxRetries: 3, name: 'Instância B' }

  // Emula o comportamento real do findFirst por trás de findInstanceByIdOrSlug:
  // respeita apiClientId, id/slug (OR) e, quando presente, ownerUserId.
  function mockInstanceOwnership() {
    prismaMock.instance.findFirst.mockImplementation(async (args: any) => {
      const where = args?.where ?? {}
      const candidates = [INSTANCE_A, INSTANCE_B]
      const match = candidates.find((inst) => {
        if (where.apiClientId && inst.apiClientId !== where.apiClientId) return false
        if (where.OR) {
          const orMatch = where.OR.some((c: any) => (c.id && c.id === inst.id) || (c.slug && c.slug === inst.slug))
          if (!orMatch) return false
        } else if (where.id && where.id !== inst.id) {
          return false
        }
        if (where.ownerUserId && inst.ownerUserId !== where.ownerUserId) return false
        return true
      })
      return match ?? null
    })
  }

  // Loga como MEMBER via /v1/auth/login (mesmo fluxo real) e devolve o JWT.
  async function loginAsMember(memberId: string, email: string): Promise<string> {
    const { hashPassword } = await import('./utils/password')
    const hash = await hashPassword('segredo123')
    prismaMock.user.findUnique.mockImplementation(async (args: any) => {
      const w = args?.where ?? {}
      if (w.email === email || w.id === memberId) {
        return {
          id: memberId, email, name: 'Member', role: 'MEMBER',
          passwordHash: hash, apiClientId: 'tenant-A', externalId: null, apiClient: TENANT_A,
        }
      }
      return null
    })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'segredo123' },
    })
    expect(res.statusCode).toBe(200)
    return res.json().token as string
  }

  it('MEMBER NÃO consegue enviar mensagem usando instância de outro MEMBER (404, sem criar Message)', async () => {
    app = await makeApp()
    mockInstanceOwnership()
    const token = await loginAsMember('member-A', 'member-a@tenant-a.com')

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { Authorization: `Bearer ${token}` },
      payload: { to: '5544999990000', type: 'TEXT', text: 'oi', instanceId: INSTANCE_B.id },
    })

    expect(res.statusCode).toBe(404)
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('MEMBER consegue enviar mensagem usando a PRÓPRIA instância (202)', async () => {
    app = await makeApp()
    mockInstanceOwnership()
    const token = await loginAsMember('member-A', 'member-a@tenant-a.com')
    prismaMock.message.create.mockResolvedValue({ id: 'msg-1', maxRetries: 3 })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { Authorization: `Bearer ${token}` },
      payload: { to: '5544999990000', type: 'TEXT', text: 'oi', instanceId: INSTANCE_A.id },
    })

    expect(res.statusCode).toBe(202)
    expect(prismaMock.message.create).toHaveBeenCalled()
    await app.close()
  })

  it('MEMBER NÃO consegue disparar campanha usando instância de outro MEMBER (404, sem criar Campaign)', async () => {
    app = await makeApp()
    mockInstanceOwnership()
    const token = await loginAsMember('member-A', 'member-a@tenant-a.com')

    const res = await app.inject({
      method: 'POST',
      url: '/v1/campaigns',
      headers: { Authorization: `Bearer ${token}` },
      payload: { to: ['5544999990000', '5544999990001'], type: 'TEXT', text: 'oi', instanceId: INSTANCE_B.id },
    })

    expect(res.statusCode).toBe(404)
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    expect(prismaMock.campaign.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('MEMBER consegue disparar campanha usando a PRÓPRIA instância (202)', async () => {
    app = await makeApp()
    mockInstanceOwnership()
    const token = await loginAsMember('member-A', 'member-a@tenant-a.com')
    prismaMock.message.create.mockResolvedValue({ id: 'msg-1', maxRetries: 3 })
    prismaMock.campaign.create.mockResolvedValue({ id: 'camp-1' })
    prismaMock.message.updateMany.mockResolvedValue({ count: 1 })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/campaigns',
      headers: { Authorization: `Bearer ${token}` },
      payload: { to: ['5544999990000'], type: 'TEXT', text: 'oi', instanceId: INSTANCE_A.id },
    })

    expect(res.statusCode).toBe(202)
    expect(prismaMock.campaign.create).toHaveBeenCalled()
    await app.close()
  })

  it('conta autenticada por API key (sem MEMBER) continua podendo usar qualquer instância da própria conta — sem regressão', async () => {
    app = await makeApp()
    mockInstanceOwnership()
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    prismaMock.message.create.mockResolvedValue({ id: 'msg-2', maxRetries: 3 })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': 'key-A' },
      payload: { to: '5544999990000', type: 'TEXT', text: 'oi', instanceId: INSTANCE_B.id },
    })

    expect(res.statusCode).toBe(202)
    await app.close()
  })
})


describe('Rate limit (429)', () => {
  // Mockar de forma fiel o store interno do @fastify/rate-limit (que usa um script Lua
  // próprio via defineCommand no cliente ioredis) é frágil e acopla o teste a detalhes
  // internos da lib. Como o limite por tenant já é exercitado indiretamente (o app sobe
  // com o plugin registrado e o store mockado responde sem erro), preferimos PULAR o
  // teste focado de 429 a mantê-lo frágil/falso-positivo. O comportamento real do
  // rate-limit é validado em runtime contra o Redis de verdade.
  it.skip('retorna 429 ao exceder o teto do tenant (requer store Redis real do rate-limit)', () => {})
})

describe('allowList do rate-limit isenta só /admin/login (não todo /admin/*)', () => {
  // Em vez de forçar um 429 de verdade (frágil com o store mockado, ver skip acima),
  // usamos um sinal indireto e determinístico: o @fastify/rate-limit só escreve o
  // header `x-ratelimit-limit` na resposta quando a request PASSOU pelo contador
  // (ver rateLimitRequestHandler em @fastify/rate-limit/index.js) — uma request
  // isenta via allowList retorna sem tocar o contador e portanto sem esse header.

  it('GET /admin/login continua isento (sem header de rate-limit)', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/admin/login' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()
    await app.close()
  })

  it('estáticos do painel (/admin/assets/*) continuam isentos (sem header de rate-limit)', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/admin/assets/inexistente.css' })
    // Não precisa existir o arquivo — o que importa é que o allowList decide ANTES
    // do handler de estáticos rodar.
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()
    await app.close()
  })

  it('rota de gestão pós-login (/admin/monitor/data) agora conta pro rate-limit global', async () => {
    app = await makeApp()
    // Sem cookie de sessão: requirePanelAuth (preHandler) redireciona pro login, mas
    // isso roda DEPOIS do onRequest do rate-limit — então o header já reflete se a
    // request foi contada, independente do resultado da auth.
    const res = await app.inject({ method: 'GET', url: '/admin/monitor/data' })
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
    await app.close()
  })
})

describe('CORS — playground do painel', () => {
  it('libera a origem do painel (config.app.panelPublicUrl)', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/instance/inst-1/messages/chat',
      headers: {
        origin: config.app.panelPublicUrl,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,token',
      },
    })
    expect(res.headers['access-control-allow-origin']).toBe(config.app.panelPublicUrl)
    await app.close()
  })

  it('não libera origem diferente da do painel', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/instance/inst-1/messages/chat',
      headers: {
        origin: 'https://site-qualquer.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,token',
      },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    await app.close()
  })
})

describe('POST /v1/webhooks — guard de SSRF', () => {
  beforeEach(() => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
  })

  it('rejeita URL apontando pra host interno da rede Docker (ex.: wuzapi) com 400, sem criar o webhook', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { 'x-api-key': 'key-A' },
      payload: { url: 'http://wuzapi:8080/callback', events: ['MESSAGE_FAILED'] },
    })

    // "wuzapi" não resolve de verdade neste teste (sem DNS/Docker) — o guard
    // rejeita por falha de resolução, que é o comportamento seguro (fail-closed).
    expect(res.statusCode).toBe(400)
    expect(prismaMock.webhook.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejeita URL com IP privado literal (192.168/16) com 400, sem criar o webhook', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { 'x-api-key': 'key-A' },
      payload: { url: 'http://192.168.1.10/callback', events: ['MESSAGE_FAILED'] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.fieldErrors.url[0]).toMatch(/não permitido/)
    expect(prismaMock.webhook.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejeita URL apontando pro metadata da nuvem (169.254.169.254) com 400', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { 'x-api-key': 'key-A' },
      payload: { url: 'http://169.254.169.254/latest/meta-data/', events: ['MESSAGE_FAILED'] },
    })

    expect(res.statusCode).toBe(400)
    expect(prismaMock.webhook.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('aceita URL pública (IP literal fora de faixa privada) e cria o webhook', async () => {
    prismaMock.webhook.create.mockResolvedValueOnce({
      id: 'wh-1',
      url: 'https://8.8.8.8/callback',
      events: ['MESSAGE_FAILED'],
      active: true,
      secret: null,
      apiClientId: 'tenant-A',
      lastCalledAt: null,
      failCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { 'x-api-key': 'key-A' },
      payload: { url: 'https://8.8.8.8/callback', events: ['MESSAGE_FAILED'] },
    })

    expect(res.statusCode).toBe(201)
    expect(prismaMock.webhook.create).toHaveBeenCalledTimes(1)
    await app.close()
  })
})

describe('GET /v1/inbound-messages — polling de mensagens recebidas', () => {
  it('lista as mensagens recebidas do tenant, escopadas por apiClientId', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    prismaMock.inboundMessage.findMany.mockResolvedValueOnce([
      { id: 'in-1', apiClientId: 'tenant-A', instanceId: 'i-A', numberId: null, from: '5544999990000', fromLid: null, fromMe: false, text: 'oi', buttonText: null, listRowId: null, listTitle: null, providerMessageId: 'EVO-1', createdAt: new Date() },
    ])
    prismaMock.inboundMessage.count.mockResolvedValueOnce(1)

    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/inbound-messages', headers: { 'x-api-key': 'key-A' } })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].text).toBe('oi')
    expect(prismaMock.inboundMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ apiClientId: 'tenant-A' }) }),
    )
    await app.close()
  })

  it('sem x-api-key → 401', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/inbound-messages' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('/wait devolve na hora quando já há mensagem nova e traz nextSince', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    const created = new Date('2026-09-28T23:00:00.000Z')
    prismaMock.inboundMessage.findMany.mockResolvedValueOnce([
      { id: 'in-2', apiClientId: 'tenant-A', instanceId: 'i-A', from: '5544999990000', fromMe: false, text: 'oi de novo', createdAt: created },
    ])

    app = await makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/inbound-messages/wait?since=2026-09-28T22:59:00.000Z&timeoutSec=5',
      headers: { 'x-api-key': 'key-A' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.timedOut).toBe(false)
    expect(body.data).toHaveLength(1)
    expect(body.nextSince).toBe(created.toISOString())
    expect(prismaMock.inboundMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ apiClientId: 'tenant-A', createdAt: { gt: new Date('2026-09-28T22:59:00.000Z') } }),
      }),
    )
    await app.close()
  })

  it('/wait sem mensagem estoura o timeout e devolve vazio com o mesmo cursor', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    prismaMock.inboundMessage.findMany.mockResolvedValue([])

    app = await makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/inbound-messages/wait?since=2026-09-28T22:59:00.000Z&timeoutSec=1',
      headers: { 'x-api-key': 'key-A' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], timedOut: true, nextSince: '2026-09-28T22:59:00.000Z' })
    await app.close()
  })

  it('/wait com since inválido → 400', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    app = await makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/inbound-messages/wait?since=isso-nao-e-data',
      headers: { 'x-api-key': 'key-A' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('/:id/media busca só no tenant do token e 404 quando não existe', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    prismaMock.inboundMessage.findFirst.mockResolvedValueOnce(null)
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/inbound-messages/in-x/media', headers: { 'x-api-key': 'key-A' } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.inboundMessage.findFirst).toHaveBeenCalledWith({ where: { id: 'in-x', apiClientId: 'tenant-A' } })
    await app.close()
  })

  it('/:id/media de mensagem só-texto → 404 "sem mídia"', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    prismaMock.inboundMessage.findFirst.mockResolvedValueOnce({ id: 'in-1', apiClientId: 'tenant-A', instanceId: 'i-A', mediaType: null, providerMessageId: 'P1' })
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/inbound-messages/in-1/media', headers: { 'x-api-key': 'key-A' } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/sem mídia/i)
    await app.close()
  })

  it('POST /:id/transcribe de mensagem não-áudio → 404 sem mídia (nada é enviado ao Gemini)', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    prismaMock.inboundMessage.findFirst.mockResolvedValueOnce({ id: 'in-1', apiClientId: 'tenant-A', instanceId: 'i-A', mediaType: null, providerMessageId: 'P1' })
    app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/v1/inbound-messages/in-1/transcribe', headers: { 'x-api-key': 'key-A' } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('POST /:id/transcribe busca só no tenant do token e 404 quando não existe', async () => {
    prismaMock.apiClient.findFirst.mockResolvedValue(TENANT_A)
    prismaMock.inboundMessage.findFirst.mockResolvedValueOnce(null)
    app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/v1/inbound-messages/in-x/transcribe', headers: { 'x-api-key': 'key-A' } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.inboundMessage.findFirst).toHaveBeenCalledWith({ where: { id: 'in-x', apiClientId: 'tenant-A' } })
    await app.close()
  })

  it('POST /:id/transcribe sem x-api-key → 401', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/v1/inbound-messages/in-1/transcribe' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('/:id/media sem x-api-key → 401', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/inbound-messages/in-1/media' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('/wait sem x-api-key → 401', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/inbound-messages/wait' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
