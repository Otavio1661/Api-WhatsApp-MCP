// src/mcp.test.ts
// Fluxo completo do MCP remoto: DCR -> /authorize (login) -> /token -> /mcp
// (tool via app.inject real). Prisma mockado (mesmo padrão de
// integration.test.ts); Redis mockado com semântica IN-MEMORY de verdade
// (Map), já que a corretude do OAuth depende de round-trip real — os
// stubs estáticos do integration.test.ts não servem aqui.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

const prismaMock = vi.hoisted(() => ({
  apiClient: { findFirst: vi.fn(), findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  instance: { findMany: vi.fn(), count: vi.fn() },
}))
vi.mock('./utils/prisma', () => ({ prisma: prismaMock }))

const redisMock = vi.hoisted(() => {
  const store = new Map<string, string>()
  const client: any = {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    expire: vi.fn(async () => 1),
    on: vi.fn(),
    // Store do @fastify/rate-limit (defineCommand) — mesmo padrão de
    // integration.test.ts, "sempre permite" (não é o foco destes testes).
    eval: vi.fn(async () => 1),
    pttl: vi.fn(async () => 60000),
    defineCommand: vi.fn((name: string) => {
      if (name === 'rateLimit') {
        client.rateLimit = (_k: string, _tw: number, _max: number, _ban: number, _ce: boolean, cb: any) =>
          cb(null, [1, 60000, false])
      }
    }),
  }
  return client
})
vi.mock('./utils/redis', () => ({ redis: redisMock }))

vi.mock('./queues/send-message.worker', () => ({ startSendMessageWorker: vi.fn(), stopSendMessageWorker: vi.fn(async () => {}) }))
vi.mock('./queues/send-message.queue', () => ({
  enqueueSend: vi.fn(async () => {}), requeueSend: vi.fn(async () => {}), removeSendJob: vi.fn(async () => {}),
  getSendQueueJobCounts: vi.fn(async () => ({})), sendMessageQueue: {},
}))
vi.mock('./queues/scheduler', () => ({ startScheduler: vi.fn(async () => {}), stopScheduler: vi.fn(async () => {}) }))

import { buildApp } from './server'

const TENANT_A = { id: 'tenant-A', name: 'Conta A', role: 'CLIENT', active: true, rateLimit: 1000, fallbackEnabled: false }
const OWNER = {
  id: 'user-1', email: 'owner@a.com', name: 'Owner', role: 'OWNER',
  passwordHash: '', apiClientId: 'tenant-A', externalId: null, apiClient: TENANT_A,
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  const { hashPassword } = await import('./utils/password')
  OWNER.passwordHash = await hashPassword('segredo123')
  prismaMock.apiClient.findFirst.mockResolvedValue(null)
  prismaMock.user.findUnique.mockImplementation(async (args: any) =>
    args?.where?.email === OWNER.email || args?.where?.id === OWNER.id ? OWNER : null,
  )
  app = buildApp()
  await app.ready()
})

// Extrai o valor de um campo hidden do HTML renderizado por login.eta.
function extractHidden(html: string, name: string): string {
  const m = html.match(new RegExp(`name="${name}" value="([^"]+)"`))
  if (!m) throw new Error(`campo hidden ${name} não encontrado no HTML`)
  return m[1]
}

describe('CSP e rate-limit da rota /mcp/oauth/authorize (achado ao vivo 2026-09-28)', () => {
  // O GET real SEMPRE vem com querystring (?response_type=code&client_id=...)
  // — uma comparação exata (===) contra '/mcp/oauth/authorize' nunca batia
  // pro GET, só pro POST (sem querystring). Regride silenciosamente se
  // alguém voltar a usar === em vez de startsWith.
  it('GET com querystring recebe o CSP relaxado (form-action, não o default restrito)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/mcp/oauth/authorize?response_type=code&client_id=x&redirect_uri=https://x.com&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256',
    })
    const csp = res.headers['content-security-policy'] as string
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain('cdn.jsdelivr.net')
  })
})

describe('form-action libera o redirect do client', () => {
  // Chromium/Edge bloqueiam o 302 pós-login pra fora do 'self' — a página
  // ficava parada no formulário e o code nunca chegava ao Claude.
  it.each([
    ['http://localhost:61067/callback', 'http://localhost:61067'],
    ['https://claude.ai/api/mcp/auth_callback', 'https://claude.ai'],
  ])('GET e re-render de erro incluem a origem de %s no form-action', async (redirectUri, origin) => {
    const codeChallenge = 'a'.repeat(43)
    const reg = await app.inject({ method: 'POST', url: '/mcp/oauth/register', payload: { redirect_uris: [redirectUri] } })
    const { client_id } = reg.json()
    const enc = encodeURIComponent(redirectUri)
    const authGet = await app.inject({
      method: 'GET',
      url: `/mcp/oauth/authorize?client_id=${client_id}&redirect_uri=${enc}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
    })
    expect(authGet.statusCode).toBe(200)
    expect(authGet.headers['content-security-policy'] as string).toContain(`form-action 'self' ${origin};`)

    const authPost = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/authorize',
      payload: { mcp_pending: extractHidden(authGet.body, 'mcp_pending'), email: OWNER.email, password: 'errada' },
    })
    expect(authPost.statusCode).toBe(401)
    expect(authPost.headers['content-security-policy'] as string).toContain(`form-action 'self' ${origin};`)
  })
})

describe('DCR — POST /mcp/oauth/register', () => {
  it('registra um client público e devolve client_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/register',
      payload: { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.client_id).toBeTruthy()
    expect(body.token_endpoint_auth_method).toBe('none')
  })

  it('sem redirect_uris → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/mcp/oauth/register', payload: { client_name: 'X' } })
    expect(res.statusCode).toBe(400)
  })

  // redirect_uri com esquema perigoso não pode nem ser
  // registrado — sem isso, um client malicioso conseguiria redirecionar o
  // authorization_code (fluxo de phishing de consentimento).
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://evil.com/cb'])(
    'redirect_uri perigosa (%s) → 400',
    async (redirectUri) => {
      const res = await app.inject({
        method: 'POST',
        url: '/mcp/oauth/register',
        payload: { client_name: 'X', redirect_uris: [redirectUri] },
      })
      expect(res.statusCode).toBe(400)
    },
  )

  it('redirect_uri http://localhost é aceita (client nativo/dev)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/register',
      payload: { client_name: 'X', redirect_uris: ['http://localhost:8080/cb'] },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('Metadata — .well-known', () => {
  it('expõe os endpoints OAuth corretos', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.authorization_endpoint).toMatch(/\/mcp\/oauth\/authorize$/)
    expect(body.code_challenge_methods_supported).toEqual(['S256'])
  })

  // Achado ao vivo 2026-09-27: client tentando reautenticar sozinho depois
  // de um 401 batia num 404 aqui — sem essa rota, a reautenticação
  // automática nunca completava (usuário sempre precisava logar manual).
  it('protected-resource também responde no caminho com /mcp anexado (RFC 9728)', async () => {
    const bare = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })
    const withPath = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' })
    expect(bare.statusCode).toBe(200)
    expect(withPath.statusCode).toBe(200)
    expect(withPath.json()).toEqual(bare.json())
  })

  it('401 em /mcp inclui WWW-Authenticate apontando pra resource_metadata', async () => {
    const res = await app.inject({ method: 'POST', url: '/mcp', payload: {} })
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/mcp')
  })
})

describe('Fluxo completo: register -> authorize -> token -> mcp', () => {
  it('emite um access_token válido e o tool consegue chamar a rota REST via inject', async () => {
    const codeVerifier = 'a'.repeat(43)
    const { createHash } = await import('node:crypto')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    const reg = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/register',
      payload: { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] },
    })
    const { client_id } = reg.json()

    const authGet = await app.inject({
      method: 'GET',
      url: `/mcp/oauth/authorize?client_id=${client_id}&redirect_uri=https://claude.ai/cb&code_challenge=${codeChallenge}&code_challenge_method=S256&state=xyz`,
    })
    expect(authGet.statusCode).toBe(200)
    const mcpPending = extractHidden(authGet.body, 'mcp_pending')

    const authPost = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/authorize',
      payload: { mcp_pending: mcpPending, email: OWNER.email, password: 'segredo123' },
    })
    expect(authPost.statusCode).toBe(302)
    const location = new URL(authPost.headers.location as string)
    expect(location.searchParams.get('state')).toBe('xyz')
    const code = location.searchParams.get('code')!
    expect(code).toBeTruthy()

    const token = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/token',
      payload: {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id,
        redirect_uri: 'https://claude.ai/cb',
      },
    })
    expect(token.statusCode).toBe(200)
    const { access_token, expires_in } = token.json()
    expect(access_token.split('.')).toHaveLength(3)
    // expires_in é a validade do JWT (7d), não o timeout de inatividade (30min).
    expect(expires_in).toBeGreaterThan(24 * 3600)

    // O MESMO code não pode ser trocado de novo (single-use).
    const replay = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/token',
      payload: {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id,
        redirect_uri: 'https://claude.ai/cb',
      },
    })
    expect(replay.statusCode).toBe(400)

    // /mcp sem token → 401.
    const noAuth = await app.inject({ method: 'POST', url: '/mcp', payload: {} })
    expect(noAuth.statusCode).toBe(401)

    // /mcp com o access_token: chama initialize (handshake MCP mínimo) pra
    // confirmar que authJwt + StreamableHTTPServerTransport aceitam o token.
    const mcpInit = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${access_token}`, accept: 'application/json, text/event-stream' },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      },
    })
    expect(mcpInit.statusCode).toBe(200)

    // o `initialize` precisa devolver `instructions` — é o que faz
    // qualquer Claude conectante (em qualquer máquina) já nascer sabendo que
    // esta conta virou uma bridge de WhatsApp, sem depender de arquivo local.
    const dataLine = mcpInit.body.split('\n').find((l) => l.startsWith('data: '))
    const parsed = JSON.parse(dataLine!.slice('data: '.length))
    expect(parsed.result.instructions).toContain('apienvios_list_inbound_messages')
    expect(parsed.result.instructions).toContain('apienvios_send_message')
    expect(parsed.result.instructions).toContain('apienvios_wait_inbound_messages')
    expect(parsed.result.instructions).toContain('sonnet')
    expect(parsed.result.instructions).toContain('CONTROL CHAT')
    expect(parsed.result.instructions).toContain('SECURITY')
    expect(parsed.result.instructions).toContain('UNTRUSTED')
    expect(parsed.result.instructions).toContain('THIRD PARTIES')
    expect(parsed.result.instructions).toContain('apienvios_get_inbound_media')
    expect(parsed.result.instructions).toContain('MEDIA')
    expect(parsed.result.instructions).toContain('apienvios_transcribe_inbound_audio')
  })

  it('PKCE errado no /token → 400', async () => {
    const codeChallenge = (await import('node:crypto')).createHash('sha256').update('verifier-certo').digest('base64url')
    const reg = await app.inject({ method: 'POST', url: '/mcp/oauth/register', payload: { redirect_uris: ['https://x.com/cb'] } })
    const { client_id } = reg.json()

    const authGet = await app.inject({
      method: 'GET',
      url: `/mcp/oauth/authorize?client_id=${client_id}&redirect_uri=https://x.com/cb&code_challenge=${codeChallenge}&code_challenge_method=S256`,
    })
    const mcpPending = extractHidden(authGet.body, 'mcp_pending')

    const authPost = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/authorize',
      payload: { mcp_pending: mcpPending, email: OWNER.email, password: 'segredo123' },
    })
    const code = new URL(authPost.headers.location as string).searchParams.get('code')!

    const token = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/token',
      payload: {
        grant_type: 'authorization_code',
        code,
        code_verifier: 'b'.repeat(43), // tamanho válido, valor errado de propósito
        client_id,
        redirect_uri: 'https://x.com/cb',
      },
    })
    expect(token.statusCode).toBe(400)
    expect(token.json().error).toBe('invalid_grant')
  })

  it('credencial inválida no POST /authorize reexibe o form com erro (sem gerar code)', async () => {
    const codeChallenge = 'a'.repeat(43)
    const reg = await app.inject({ method: 'POST', url: '/mcp/oauth/register', payload: { redirect_uris: ['https://x.com/cb'] } })
    const { client_id } = reg.json()
    const authGet = await app.inject({
      method: 'GET',
      url: `/mcp/oauth/authorize?client_id=${client_id}&redirect_uri=https://x.com/cb&code_challenge=${codeChallenge}&code_challenge_method=S256`,
    })
    const mcpPending = extractHidden(authGet.body, 'mcp_pending')

    const authPost = await app.inject({
      method: 'POST',
      url: '/mcp/oauth/authorize',
      payload: { mcp_pending: mcpPending, email: OWNER.email, password: 'senha-errada' },
    })
    expect(authPost.statusCode).toBe(401)
    expect(authPost.body).toContain('Credenciais inválidas')
  })
})
