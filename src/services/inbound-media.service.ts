// src/services/inbound-media.service.ts
// Interpretação de mídia recebida. Evolution só entrega mensagem/mídia;
// quem "entende" é o Gemini (áudio → texto) e o próprio Claude (imagem, via tool MCP).
import type { InboundMessage, Provider } from '../types'
import { providers } from '../providers'
import type { EvolutionProvider } from '../providers/evolution.provider'
import { transcribeAudio } from './gemini.service'
import { logger } from '../utils/logger'

// Limite pra não mandar áudio gigante (podcast encaminhado) pro Gemini.
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024

export function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

// Transcreve só áudio do PRÓPRIO dono (fromMe): áudio de terceiro nunca é
// respondido pelo bridge, então não vale mandar a voz de um contato pro Google
// nem gastar a cota. Mexe no objeto in-place (text = transcrição) e SEMPRE
// resolve — falha aqui nunca pode impedir a mensagem de ser salva.
// Sessão do provider por onde a mensagem chegou (Evolution: `num-<id>` do número
// ou o Instance.instanceId, conforme a rota de webhook que recebeu).
export interface MediaSource {
  provider: Provider
  providerInstanceName?: string | null
}

export async function enrichInboundMedia(msg: InboundMessage, source: MediaSource): Promise<void> {
  const base64 = msg.mediaBase64
  delete msg.mediaBase64
  try {
    if (msg.mediaType !== 'audio' || !msg.fromMe || msg.text) return

    let audio = base64
    let mimetype = msg.mimetype
    if (!audio && msg.providerMessageId && source.provider === 'EVOLUTION' && source.providerInstanceName) {
      const fetched = await (providers.EVOLUTION as EvolutionProvider).getMediaBase64(source.providerInstanceName, msg.providerMessageId)
      audio = fetched?.base64
      mimetype = mimetype ?? fetched?.mimetype
    }
    if (!audio || base64Bytes(audio) > MAX_MEDIA_BYTES) return

    const transcription = await transcribeAudio(audio, mimetype ?? 'audio/ogg')
    if (transcription) msg.text = transcription
  } catch (err: any) {
    logger.warn(`[InboundMedia] enriquecimento falhou: ${err?.message}`)
  }
}
