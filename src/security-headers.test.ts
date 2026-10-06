// src/security-headers.test.ts
// CSP estava desligada globalmente (`contentSecurityPolicy: false` no
// helmet, ver server.ts) — inclusive pra API REST (/v1/*), que só responde JSON e
// não tinha ganho nenhum em ficar sem a proteção. Este teste garante:
//   1. /admin/* (painel) recebe CSP relaxado (só o necessário: Alpine via CDN
//      jsdelivr, onsubmit inline, fonte Google Fonts, fetch cross-origin pra
//      apiPublicUrl) — sem isso o painel quebra visualmente/funcionalmente.
//   2. /v1/* (API REST) e demais rotas recebem o CSP padrão do helmet — restrito,
//      SEM 'unsafe-inline'/'unsafe-eval'/CDN nenhum.
// Mesmo mock mínimo de prisma/redis/queues do integration.test.ts (buildApp()
// importa esses módulos via server.ts; sem mock eles tentariam conectar de verdade).
import { describe, it, expect, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const prismaMock = vi.hoisted(() => ({
  apiClient: { findUnique: vi.fn(async () => null), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  instance: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
  message: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  webhook: { findMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
}))
vi.mock('./utils/prisma', () => ({ prisma: prismaMock }))

const redisMock = vi.hoisted(() => {
  const client: any = {
    on: vi.fn(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    eval: vi.fn(async () => 1),
    pttl: vi.fn(async () => 60000),
    ping: vi.fn(async () => 'PONG'),
    defineCommand: vi.fn((name: string) => {
      if (name === 'rateLimit') {
        client.rateLimit = (_key: string, _tw: number, _max: number, _ban: number, _ce: boolean, cb: any) => {
          cb(null, [1, 60000, false])
        }
      }
    }),
  }
  return client
})
vi.mock('./utils/redis', () => ({ redis: redisMock }))

vi.mock('./queues/send-message.worker', () => ({
  startSendMessageWorker: vi.fn(),
  stopSendMessageWorker: vi.fn(async () => {}),
}))
vi.mock('./queues/send-message.queue', () => ({
  enqueueSend: vi.fn(async () => {}),
  getSendQueueJobCounts: vi.fn(async () => ({})),
}))
vi.mock('./queues/scheduler', () => ({
  startScheduler: vi.fn(async () => {}),
  stopScheduler: vi.fn(async () => {}),
}))

import { buildApp } from './server'
import { config } from './config'

async function makeApp(): Promise<FastifyInstance> {
  const a = buildApp()
  await a.ready()
  return a
}

describe('CSP por prefixo de rota', () => {
  it('/admin/login recebe CSP relaxado com só as fontes externas que o painel usa', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/admin/login' })
    expect(res.statusCode).toBe(200)

    const csp = res.headers['content-security-policy']
    expect(csp).toBeTruthy()
    const value = String(csp)

    // Alpine.js via CDN jsdelivr — precisa de 'unsafe-eval' (avalia x-data/x-on).
    expect(value).toMatch(/script-src[^;]*'unsafe-eval'/)
    expect(value).toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(value).toMatch(/script-src[^;]*https:\/\/cdn\.jsdelivr\.net/)
    // onsubmit="..." inline nos formulários — governado por script-src-attr, NÃO
    // por script-src (senão cai no default do helmet, que é 'none').
    expect(value).toMatch(/script-src-attr[^;]*'unsafe-inline'/)
    // Fonte Inter (Google Fonts) via <link> no layout + @import no login.eta.
    expect(value).toMatch(/style-src[^;]*https:\/\/fonts\.googleapis\.com/)
    expect(value).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/)
    // Playground "Testar recursos" (instance.eta) chama a API REST cross-origin
    // direto do navegador — connect-src precisa liberar o domínio da API.
    expect(value).toMatch(new RegExp(`connect-src[^;]*${config.app.apiPublicUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))

    await app.close()
  })

  it('/v1/* (API REST) mantém o CSP padrão do helmet — restrito, sem CDN/unsafe-*', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/v1/instances' })
    // Sem credencial (401), mas o header de segurança já deve estar setado no
    // onRequest, antes de qualquer guard de auth rodar.
    expect(res.statusCode).toBe(401)

    const csp = res.headers['content-security-policy']
    expect(csp).toBeTruthy()
    const value = String(csp)

    // script-src é a diretiva que importa aqui: sem CDN, sem 'unsafe-eval', sem
    // 'unsafe-inline' — o default do helmet ('self' puro). (style-src continua com
    // 'unsafe-inline' por default DO PRÓPRIO helmet, não é algo que este card
    // relaxou — não faz parte do escopo mexer nisso pra API.)
    expect(value).toMatch(/script-src 'self'(;|$)/)
    expect(value).not.toMatch(/cdn\.jsdelivr\.net/)
    expect(value).not.toMatch(/fonts\.googleapis\.com/)
    expect(value).toMatch(/script-src-attr 'none'/)

    await app.close()
  })

  it('/health também mantém o CSP padrão restrito (fora de /admin e /v1)', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)

    const csp = res.headers['content-security-policy']
    expect(csp).toBeTruthy()
    expect(String(csp)).toMatch(/script-src 'self'/)

    await app.close()
  })
})
