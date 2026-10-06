// src/services/inbound-media.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { transcribeMock, getMediaMock } = vi.hoisted(() => ({
  transcribeMock: vi.fn(),
  getMediaMock: vi.fn(),
}))
vi.mock('./gemini.service', () => ({ transcribeAudio: transcribeMock }))
vi.mock('../providers', () => ({ providers: { EVOLUTION: { getMediaBase64: getMediaMock } } }))

import { enrichInboundMedia } from './inbound-media.service'
import type { InboundMessage } from '../types'

const instance = { provider: 'EVOLUTION', providerInstanceName: 'num-abc' } as const
const audio = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  from: '5544',
  fromMe: true,
  mediaType: 'audio',
  mimetype: 'audio/ogg; codecs=opus',
  providerMessageId: 'AUD1',
  ...over,
})

describe('enrichInboundMedia', () => {
  beforeEach(() => {
    transcribeMock.mockReset()
    getMediaMock.mockReset()
  })

  it('transcreve áudio do dono usando o base64 do webhook e descarta o base64 do objeto', async () => {
    transcribeMock.mockResolvedValue('Claude, tá aí?')
    const msg = audio({ mediaBase64: 'QUJD' })
    await enrichInboundMedia(msg, instance)
    expect(msg.text).toBe('Claude, tá aí?')
    expect(msg.mediaBase64).toBeUndefined()
    expect(getMediaMock).not.toHaveBeenCalled()
    expect(transcribeMock).toHaveBeenCalledWith('QUJD', 'audio/ogg; codecs=opus')
  })

  it('sem base64 no webhook, baixa pela Evolution', async () => {
    getMediaMock.mockResolvedValue({ base64: 'REVG', mimetype: 'audio/ogg' })
    transcribeMock.mockResolvedValue('oi')
    const msg = audio()
    await enrichInboundMedia(msg, instance)
    expect(getMediaMock).toHaveBeenCalledWith('num-abc', 'AUD1')
    expect(msg.text).toBe('oi')
  })

  it('NÃO transcreve áudio de terceiro (fromMe=false): nada vai pro Gemini', async () => {
    const msg = audio({ fromMe: false, mediaBase64: 'QUJD' })
    await enrichInboundMedia(msg, instance)
    expect(transcribeMock).not.toHaveBeenCalled()
    expect(msg.text).toBeUndefined()
    expect(msg.mediaBase64).toBeUndefined()
  })

  it('imagem não é transcrita', async () => {
    const msg = audio({ mediaType: 'image', mediaBase64: 'QUJD' })
    await enrichInboundMedia(msg, instance)
    expect(transcribeMock).not.toHaveBeenCalled()
  })

  it('falha do Gemini/Evolution nunca lança: mensagem segue sem text', async () => {
    transcribeMock.mockRejectedValue(new Error('boom'))
    const msg = audio({ mediaBase64: 'QUJD' })
    await expect(enrichInboundMedia(msg, instance)).resolves.toBeUndefined()
    expect(msg.text).toBeUndefined()

    getMediaMock.mockRejectedValue(new Error('down'))
    await expect(enrichInboundMedia(audio(), instance)).resolves.toBeUndefined()
  })

  it('áudio grande demais não vai pro Gemini', async () => {
    const big = 'A'.repeat(12 * 1024 * 1024)
    const msg = audio({ mediaBase64: big })
    await enrichInboundMedia(msg, instance)
    expect(transcribeMock).not.toHaveBeenCalled()
  })
})
