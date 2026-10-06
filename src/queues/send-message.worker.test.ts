// src/queues/send-message.worker.test.ts
// se o worker cair entre o envio bem-sucedido e a gravação do
// status SENT, o job fica "stalled" no BullMQ com a Message em SENDING e é
// redespachado. Sem a guarda de recuperação, isso reenvia a mensagem de
// verdade (duplicidade no destinatário). Testa que, havendo já um
// MessageAttempt de sucesso registrado, o worker finaliza o status sem
// chamar o provider de novo.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  message: { findUnique: vi.fn(), update: vi.fn() },
  messageAttempt: { findFirst: vi.fn(), create: vi.fn() },
  apiClient: { update: vi.fn() },
}))
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }))

const sendViaInstanceMock = vi.hoisted(() => vi.fn())
const sendWithFallbackMock = vi.hoisted(() => vi.fn())
vi.mock('../services/provider-router.service', () => ({
  sendViaInstance: sendViaInstanceMock,
  sendWithFallback: sendWithFallbackMock,
}))

const dispatchWebhookMock = vi.hoisted(() => vi.fn())
vi.mock('../services/notification.service', () => ({ dispatchWebhook: dispatchWebhookMock }))

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { processJob } from './send-message.worker'

function baseMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'msg-1',
    apiClientId: 'client-1',
    instanceId: null,
    instance: null,
    toPhone: '5511999999999',
    type: 'TEXT',
    content: 'oi',
    caption: null,
    buttons: null,
    location: null,
    contact: null,
    poll: null,
    list: null,
    status: 'SENDING',
    ...overrides,
  }
}

function fakeJob(attemptsMade = 1) {
  return {
    data: { messageId: 'msg-1' },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Parameters<typeof processJob>[0]
}

describe('processJob — recuperação de crash em SENDING', () => {
  beforeEach(() => vi.clearAllMocks())

  it('não reenvia ao provider quando já existe um MessageAttempt de sucesso', async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce(baseMessage())
    prismaMock.messageAttempt.findFirst.mockResolvedValueOnce({
      id: 'att-1',
      messageId: 'msg-1',
      provider: 'EVOLUTION',
      attempt: 1,
      success: true,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    })

    await processJob(fakeJob())

    expect(sendViaInstanceMock).not.toHaveBeenCalled()
    expect(sendWithFallbackMock).not.toHaveBeenCalled()
    expect(prismaMock.message.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: expect.objectContaining({ status: 'SENT', provider: 'EVOLUTION' }),
    })
  })

  it('segue o fluxo normal de envio quando SENDING não tem attempt de sucesso prévio', async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce(baseMessage())
    prismaMock.messageAttempt.findFirst.mockResolvedValueOnce(null)
    sendWithFallbackMock.mockResolvedValueOnce({ success: true, provider: 'EVOLUTION', providerId: 'p-1' })

    await processJob(fakeJob())

    expect(sendWithFallbackMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.messageAttempt.create).toHaveBeenCalledTimes(1)
  })

  it('mensagens já finalizadas continuam sendo ignoradas (guard existente)', async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce(baseMessage({ status: 'SENT' }))

    await processJob(fakeJob())

    expect(prismaMock.messageAttempt.findFirst).not.toHaveBeenCalled()
    expect(sendWithFallbackMock).not.toHaveBeenCalled()
  })
})
