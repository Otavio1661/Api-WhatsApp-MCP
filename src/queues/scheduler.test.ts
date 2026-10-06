// src/queues/scheduler.test.ts
// Testes unitários da promoção SCHEDULED → QUEUED (processScheduledMessages), foco no
// bug do o teto anti-flood por destinatário (checkRecipientHourlyLimit) tem
// que ser aplicado NESTE ponto — é aqui que o comentário histórico da rota /messages
// promete o enforcement pra mensagens agendadas, mas o código nunca chamava a função.
//
// Mocka bullmq/connection (evita conectar Redis de verdade só por importar o módulo),
// a fila de envio, o próprio limite anti-flood e os módulos usados só por outros jobs
// da maintenance queue (reset-counters/health), que não são exercitados aqui.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: vi.fn(async () => {}) })),
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn(), close: vi.fn(async () => {}) })),
}))
vi.mock('./connection', () => ({
  bullConnection: {},
  QUEUE_SEND_MESSAGE: 'send-message',
  QUEUE_MAINTENANCE: 'maintenance',
  QUEUE_WEBHOOK: 'webhook-delivery',
}))
vi.mock('../jobs/reset-counters.job', () => ({ resetDailyCounters: vi.fn() }))
vi.mock('../providers', () => ({ providers: {} }))
vi.mock('../services/notification.service', () => ({ dispatchWebhook: vi.fn() }))
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const prismaMock = vi.hoisted(() => ({
  message: { findMany: vi.fn(), update: vi.fn() },
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

const enqueueSendMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./send-message.queue', () => ({ enqueueSend: enqueueSendMock }))

const checkRecipientHourlyLimitMock = vi.hoisted(() => vi.fn())
vi.mock('../utils/recipient-rate-limit', () => ({
  checkRecipientHourlyLimit: checkRecipientHourlyLimitMock,
}))

import { processScheduledMessages } from './scheduler'

function dueMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'msg-1',
    maxRetries: 3,
    apiClientId: 'tenant-A',
    instanceId: 'inst-1',
    toPhone: '5544999990000',
    apiClient: { maxPerRecipientPerHour: 3 },
    ...overrides,
  }
}

describe('processScheduledMessages — anti-flood por destinatário', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dentro do teto: promove SCHEDULED → QUEUED e enfileira', async () => {
    prismaMock.message.findMany.mockResolvedValue([dueMessage()])
    checkRecipientHourlyLimitMock.mockResolvedValue({ allowed: true, limit: 3, count: 1, retryAfterSec: 0 })

    await processScheduledMessages()

    expect(checkRecipientHourlyLimitMock).toHaveBeenCalledWith('tenant-A', '5544999990000', 3)
    expect(prismaMock.message.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'QUEUED' },
    })
    expect(enqueueSendMock).toHaveBeenCalledWith('msg-1', 3, 'inst-1')
  })

  it('teto atingido: NÃO promove nem enfileira — permanece SCHEDULED pro próximo tick', async () => {
    prismaMock.message.findMany.mockResolvedValue([dueMessage()])
    checkRecipientHourlyLimitMock.mockResolvedValue({ allowed: false, limit: 3, count: 3, retryAfterSec: 120 })

    await processScheduledMessages()

    expect(prismaMock.message.update).not.toHaveBeenCalled()
    expect(enqueueSendMock).not.toHaveBeenCalled()
  })

  it('lote misto: só as permitidas são promovidas, cada uma checada individualmente', async () => {
    const allowedMsg = dueMessage({ id: 'msg-ok', toPhone: '5544911110000' })
    const blockedMsg = dueMessage({ id: 'msg-blocked', toPhone: '5544999990000' })
    prismaMock.message.findMany.mockResolvedValue([allowedMsg, blockedMsg])
    checkRecipientHourlyLimitMock.mockImplementation(async (_acc: string, to: string) => (
      to === '5544911110000'
        ? { allowed: true, limit: 3, count: 1, retryAfterSec: 0 }
        : { allowed: false, limit: 3, count: 3, retryAfterSec: 60 }
    ))

    await processScheduledMessages()

    expect(prismaMock.message.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.message.update).toHaveBeenCalledWith({ where: { id: 'msg-ok' }, data: { status: 'QUEUED' } })
    expect(enqueueSendMock).toHaveBeenCalledTimes(1)
    expect(enqueueSendMock).toHaveBeenCalledWith('msg-ok', 3, 'inst-1')
  })

  it('sem instância (fallback de conta): partitionKey cai pro apiClientId', async () => {
    prismaMock.message.findMany.mockResolvedValue([dueMessage({ instanceId: null })])
    checkRecipientHourlyLimitMock.mockResolvedValue({ allowed: true, limit: 3, count: 1, retryAfterSec: 0 })

    await processScheduledMessages()

    expect(enqueueSendMock).toHaveBeenCalledWith('msg-1', 3, 'tenant-A')
  })

  it('sem mensagens vencidas: não chama o limite nem a fila', async () => {
    prismaMock.message.findMany.mockResolvedValue([])

    await processScheduledMessages()

    expect(checkRecipientHourlyLimitMock).not.toHaveBeenCalled()
    expect(enqueueSendMock).not.toHaveBeenCalled()
  })
})
