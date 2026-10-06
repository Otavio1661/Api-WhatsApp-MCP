// src/services/gemini.service.ts
// Transcrição de áudio via Gemini (REST). Nunca lança: falha vira null e quem
// chama segue sem a transcrição (a mensagem é salva do mesmo jeito).
import axios from 'axios'
import { config } from '../config'
import { logger } from '../utils/logger'

const PROMPT =
  'Transcreva fielmente este áudio de WhatsApp, no idioma falado. Responda SOMENTE com a transcrição, sem comentários, aspas ou explicações. Se não houver fala, responda exatamente: [sem fala]'

// Áudio de WhatsApp costuma vir como "audio/ogg; codecs=opus" — o Gemini quer só o tipo base.
function baseMime(mimetype: string): string {
  return mimetype.split(';')[0].trim() || 'audio/ogg'
}

const RETRYABLE = new Set([429, 500, 503])

export async function transcribeAudio(base64: string, mimetype: string): Promise<string | null> {
  if (!config.gemini.enabled) return null
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`
  const body = { contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: baseMime(mimetype), data: base64 } }] }] }
  // Chave no header (não na URL) pra nunca aparecer em log/erro de request.
  const opts = { headers: { 'x-goog-api-key': config.gemini.apiKey }, timeout: 25000 }

  // O Gemini responde 503 "alta demanda" com frequência (observado na prática) — 1 retentativa.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.post(url, body, opts)
      const text = res.data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('').trim()
      return text || null
    } catch (err: any) {
      const status = err?.response?.status
      if (attempt === 1 && RETRYABLE.has(status)) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      logger.warn(`[Gemini] transcrição falhou: ${status ?? err?.message}`)
      return null
    }
  }
  return null
}
