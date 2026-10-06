// src/queues/webhook.worker.test.ts
// Cobre o guard de SSRF aplicado na entrega: URL interna/privada
// nunca deve chegar ao axios.post, e a chamada real deve sempre usar o IP
// pinado (pinnedAgents), nunca deixar a lib HTTP re-resolver o hostname.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import dns from 'node:dns'

const prismaMock = vi.hoisted(() => ({
  webhook: { findUnique: vi.fn(), update: vi.fn() },
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

const axiosMock = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: axiosMock }))

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { processJob } from './webhook.worker'

function fakeJob(overrides: Partial<Job<any>> = {}): Job<any> {
  return {
    data: { webhookId: 'wh-1', event: 'MESSAGE_FAILED', payload: { x: 1 } },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as Job<any>
}

describe('webhook.worker processJob — guard de SSRF na entrega', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejeita e NUNCA chama axios.post quando webhook.url é IP privado (rede Docker interna)', async () => {
    prismaMock.webhook.findUnique.mockResolvedValueOnce({
      id: 'wh-1',
      url: 'http://172.20.0.5:8080/callback', // ex.: evolution/wuzapi na rede interna
      active: true,
      secret: null,
    })

    await expect(processJob(fakeJob())).rejects.toThrow(/não permitido/)

    expect(axiosMock.post).not.toHaveBeenCalled()
    // Ainda assim registra a falha (mesmo comportamento de qualquer erro de entrega).
    expect(prismaMock.webhook.update).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
      data: { failCount: { increment: 1 } },
    })
  })

  it('rejeita URL apontando pro metadata da nuvem (169.254.169.254)', async () => {
    prismaMock.webhook.findUnique.mockResolvedValueOnce({
      id: 'wh-1',
      url: 'http://169.254.169.254/latest/meta-data/',
      active: true,
      secret: null,
    })

    await expect(processJob(fakeJob())).rejects.toThrow(/não permitido/)
    expect(axiosMock.post).not.toHaveBeenCalled()
  })

  it('rejeita hostname que resolve (DNS) pra IP privado — cobre DNS rebinding', async () => {
    prismaMock.webhook.findUnique.mockResolvedValueOnce({
      id: 'wh-1',
      url: 'http://interno.exemplo.com/callback',
      active: true,
      secret: null,
    })
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
      { address: '10.0.0.9', family: 4 },
    ] as any)

    await expect(processJob(fakeJob())).rejects.toThrow(/não permitido/)
    expect(axiosMock.post).not.toHaveBeenCalled()
  })

  it('entrega normalmente para URL pública e usa o IP pinado na chamada real (httpAgent/httpsAgent)', async () => {
    prismaMock.webhook.findUnique.mockResolvedValueOnce({
      id: 'wh-1',
      url: 'https://8.8.8.8/callback',
      active: true,
      secret: null,
    })
    axiosMock.post.mockResolvedValueOnce({ status: 200 })

    await processJob(fakeJob())

    expect(axiosMock.post).toHaveBeenCalledTimes(1)
    const [url, , opts] = axiosMock.post.mock.calls[0]
    expect(url).toBe('https://8.8.8.8/callback')
    expect(opts.httpAgent).toBeDefined()
    expect(opts.httpsAgent).toBeDefined()
    expect(prismaMock.webhook.update).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
      data: { lastCalledAt: expect.any(Date), failCount: 0 },
    })
  })

  it('webhook inativo/inexistente: não chega nem a validar a URL', async () => {
    prismaMock.webhook.findUnique.mockResolvedValueOnce(null)
    await processJob(fakeJob())
    expect(axiosMock.post).not.toHaveBeenCalled()
  })
})
