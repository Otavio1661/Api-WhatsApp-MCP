// src/web/docs-mcp.test.ts
// A página Docs do painel (/admin/docs) agora traz a documentação do MCP,
// gerada dos mesmos docs/**/*.md (scripts/gen-panel-mcp-docs.ts). Garante:
//   - rota protegida por login (redireciona sem sessão) e 200 para OWNER e MEMBER;
//   - seção MCP presente, com a URL do AMBIENTE (não a fixa de produção);
//   - as 30 tools do código aparecem na documentação (não diverge das definições reais);
//   - o arquivo gerado está em dia com os .md (senão: npm run docs:panel-mcp);
//   - o renderizador não deixa passar HTML cru, javascript: nem atributos de evento.
// Prisma e Redis mockados (mesmo padrão de src/mcp.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

const prismaMock = vi.hoisted(() => ({
  apiClient: { findFirst: vi.fn(), findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  instance: { findMany: vi.fn(), count: vi.fn() },
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

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
vi.mock('../utils/redis', () => ({ redis: redisMock }))

vi.mock('../queues/send-message.worker', () => ({ startSendMessageWorker: vi.fn(), stopSendMessageWorker: vi.fn(async () => {}) }))
vi.mock('../queues/send-message.queue', () => ({
  enqueueSend: vi.fn(async () => {}), requeueSend: vi.fn(async () => {}), removeSendJob: vi.fn(async () => {}),
  getSendQueueJobCounts: vi.fn(async () => ({})), sendMessageQueue: {},
}))
vi.mock('../queues/scheduler', () => ({ startScheduler: vi.fn(async () => {}), stopScheduler: vi.fn(async () => {}) }))

import { buildApp } from '../server'
import { config } from '../config'
import { renderMarkdown, generatedModuleSource, SECTIONS } from './mcp-docs-builder'
import { registerMessagesTools } from '../mcp/tools/messages.tools'
import { registerInstancesTools } from '../mcp/tools/instances.tools'
import { registerCampaignsTools } from '../mcp/tools/campaigns.tools'
import { registerWebhooksTools } from '../mcp/tools/webhooks.tools'
import { registerMetricsTools } from '../mcp/tools/metrics.tools'
import { registerAccountTools } from '../mcp/tools/account.tools'

const TENANT_A = { id: 'tenant-A', name: 'Conta A', role: 'CLIENT', active: true, rateLimit: 1000, fallbackEnabled: false, apiKey: 'key-A' }
const OWNER = { id: 'user-1', email: 'owner@a.com', name: 'Owner', role: 'OWNER', apiClientId: 'tenant-A', apiClient: TENANT_A }
const MEMBER = { ...OWNER, id: 'user-2', email: 'member@a.com', name: 'Member', role: 'MEMBER' }

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  prismaMock.apiClient.findFirst.mockResolvedValue(null)
  prismaMock.instance.findMany.mockResolvedValue([])
  prismaMock.user.findUnique.mockImplementation(async (args: any) => {
    if (args?.where?.id === OWNER.id) return OWNER
    if (args?.where?.id === MEMBER.id) return MEMBER
    return null
  })
  app = buildApp()
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function cookieFor(userId: string): string {
  const token = app.jwt.sign({ userId, apiClientId: 'tenant-A', accountRole: 'CLIENT', jti: `jti-${userId}` })
  return `token=${token}`
}

function registeredToolNames(): string[] {
  const names: string[] = []
  const fake = { tool: (name: string) => void names.push(name) }
  const ctx = { app: {} as never, token: '' }
  for (const reg of [registerMessagesTools, registerInstancesTools, registerCampaignsTools, registerWebhooksTools, registerMetricsTools, registerAccountTools]) {
    reg(fake as never, ctx as never)
  }
  return names
}

describe('GET /admin/docs — seção MCP', () => {
  it('sem sessão redireciona para o login (a documentação exige usuário logado)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/docs' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/admin/login')
    expect(res.body).not.toContain('apienvios_send_message')
  })

  it.each([
    ['OWNER', OWNER.id],
    ['MEMBER', MEMBER.id],
  ])('%s logado recebe 200 com a seção MCP e a URL do ambiente', async (_papel, userId) => {
    const res = await app.inject({ method: 'GET', url: '/admin/docs', headers: { cookie: cookieFor(userId) } })
    expect(res.statusCode).toBe(200)
    const base = config.app.apiPublicUrl.replace(/\/$/, '')
    expect(res.body).toContain('id="mcp"')
    expect(res.body).toContain('href="#mcp"')
    for (const s of SECTIONS) expect(res.body).toContain(`id="mcp-${s.id}"`)
    expect(res.body).toContain(`${base}/mcp`)
    expect(res.body).not.toContain('__MCP_API_BASE__')
    // A URL de exemplo dos .md só aparece se for a do próprio ambiente.
    if (base !== 'https://api.example.com') expect(res.body).not.toContain('api.example.com')
  })

  it('a seção MCP não injeta <script> nem manipuladores de evento inline', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/docs', headers: { cookie: cookieFor(OWNER.id) } })
    const mcp = res.body.slice(res.body.indexOf('id="mcp"'))
    expect(mcp).not.toMatch(/<script/i)
    expect(mcp).not.toMatch(/\son[a-z]+\s*=/i)
    expect(mcp).not.toMatch(/href="javascript:/i)
  })

  it('o CSP do painel continua o mesmo (não foi afrouxado)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/docs', headers: { cookie: cookieFor(OWNER.id) } })
    const csp = res.headers['content-security-policy'] as string
    expect(csp).toContain('cdn.jsdelivr.net')
    expect(csp).not.toMatch(/script-src[^;]*\*/)
  })
})

describe('Conteúdo gerado dos .md', () => {
  it('lista as 30 tools reais do código, sem sobrar nem faltar', async () => {
    const names = registeredToolNames()
    expect(names).toHaveLength(30)
    const res = await app.inject({ method: 'GET', url: '/admin/docs', headers: { cookie: cookieFor(OWNER.id) } })
    const ferramentas = res.body.slice(res.body.indexOf('id="mcp-ferramentas"'), res.body.indexOf('id="mcp-seguranca"'))
    for (const n of names) expect(ferramentas).toContain(n)
    const documentadas = new Set([...ferramentas.matchAll(/\bapienvios_[a-z_]+\b/g)].map((m) => m[0]))
    for (const d of documentadas) expect(names).toContain(d)
  })

  it('mcp-docs.generated.ts está em dia com docs/**/*.md (rode npm run docs:panel-mcp)', () => {
    const root = join(__dirname, '..', '..')
    const atual = readFileSync(join(root, 'src', 'web', 'mcp-docs.generated.ts'), 'utf8')
    expect(generatedModuleSource(root)).toBe(atual)
  })

  it('o HTML gerado não tem emoji', () => {
    const root = join(__dirname, '..', '..')
    expect(generatedModuleSource(root)).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

describe('Renderizador de markdown (sanitização)', () => {
  const ctx = { cardId: 'mcp-teste', file: 'docs/mcp/overview.md', anchors: new Map([['mcp-teste', new Set<string>()]]) }

  it('escapa HTML cru: nada de <script>, <img onerror> ou <iframe>', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\ntexto <iframe src="//x"></iframe>', ctx)
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<img/i)
    expect(html).not.toMatch(/<iframe/i)
    expect(html).toContain('&lt;script&gt;')
  })

  it('descarta links com esquemas perigosos e abre externos com rel seguro', () => {
    const html = renderMarkdown('[a](javascript:alert(1)) [b](data:text/html;base64,AAAA) [c](vbscript:x) [d](https://exemplo.com/x) [e](file:///etc/passwd)', ctx)
    expect(html).not.toMatch(/href="(javascript|data|vbscript|file):/i)
    expect(html).toContain('href="https://exemplo.com/x" target="_blank" rel="noopener noreferrer"')
  })

  it('imagens viram texto (sem <img>) e nada de atributo de evento sai do markdown', () => {
    const html = renderMarkdown('![x" onerror="alert(1)](https://exemplo.com/a.png) `<b onclick=x>` e **negrito**', ctx)
    expect(html).not.toMatch(/<img/i)
    expect(html).not.toMatch(/<b\s+onclick/i)
    expect(html).toContain('<strong>negrito</strong>')
  })

  it('bloco de código escapa o conteúdo e ganha o botão Copiar', () => {
    const html = renderMarkdown('```bash\necho "<b>x</b>" && curl https://exemplo.com\n```', ctx)
    expect(html).toContain('class="code-copy"')
    expect(html).toContain('echo &quot;&lt;b&gt;x&lt;/b&gt;&quot;')
  })
})
