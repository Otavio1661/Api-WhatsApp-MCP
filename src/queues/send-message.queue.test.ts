// src/queues/send-message.queue.test.ts
// mensagem presa em SENDING sem caminho de recuperação (worker morreu
// de vez e o BullMQ estourou o maxStalledCount sem nunca marcar FAILED). O
// reenvio manual passa a permitir SENDING quando o job correspondente já não
// existe mais na fila (jobId = messageId) — testa só o helper `sendJobExists`,
// que é a peça nova; a decisão de liberar o resend fica nas rotas.
//
// getJob() do BullMQ retorna o job mesmo já 'completed'/'failed' (só some
// quando o histórico é limpo) — por isso sendJobExists checa o ESTADO do job,
// não só a presença. Os testes cobrem os dois lados dessa distinção.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getJobMock = vi.hoisted(() => vi.fn())
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    getJob: getJobMock,
    getJobCounts: vi.fn(async () => ({})),
  })),
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn(), close: vi.fn(async () => {}) })),
}))
vi.mock('./connection', () => ({
  bullConnection: {},
  QUEUE_SEND_MESSAGE: 'send-message',
  QUEUE_MAINTENANCE: 'maintenance',
  QUEUE_WEBHOOK: 'webhook-delivery',
}))

const prismaMock = vi.hoisted(() => ({
  message: { findUnique: vi.fn() },
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

import { sendJobExists } from './send-message.queue'

describe('sendJobExists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['waiting', 'delayed', 'prioritized', 'waiting-children', 'active'] as const)(
    'retorna true quando o job existe e está em estado "%s" (ainda vai rodar)',
    async (state) => {
      prismaMock.message.findUnique.mockResolvedValueOnce({ instanceId: null, apiClientId: 'client-1' })
      getJobMock.mockResolvedValueOnce({ id: 'msg-1', getState: vi.fn(async () => state) })

      await expect(sendJobExists('msg-1')).resolves.toBe(true)
      expect(getJobMock).toHaveBeenCalledWith('msg-1')
    },
  )

  it.each(['completed', 'failed', 'unknown'] as const)(
    'retorna false quando o job existe no Redis mas já terminou (estado "%s")',
    async (state) => {
      prismaMock.message.findUnique.mockResolvedValueOnce({ instanceId: null, apiClientId: 'client-1' })
      getJobMock.mockResolvedValueOnce({ id: 'msg-1', getState: vi.fn(async () => state) })

      await expect(sendJobExists('msg-1')).resolves.toBe(false)
    },
  )

  it('retorna false quando o job sumiu da fila de vez (worker morreu, maxStalledCount estourou)', async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce({ instanceId: null, apiClientId: 'client-1' })
    getJobMock.mockResolvedValueOnce(undefined)

    await expect(sendJobExists('msg-1')).resolves.toBe(false)
  })

  it('retorna false quando a mensagem nem existe mais no banco', async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce(null)

    await expect(sendJobExists('msg-inexistente')).resolves.toBe(false)
    expect(getJobMock).not.toHaveBeenCalled()
  })
})
