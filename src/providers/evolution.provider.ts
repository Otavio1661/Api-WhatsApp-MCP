// src/providers/evolution.provider.ts
import axios, { AxiosInstance } from 'axios'
import { config } from '../config'
import { logger } from '../utils/logger'
import type { IWhatsappProvider, ProviderSendResult, InstanceStatus, MessageType, Provider } from '../types'

export class EvolutionProvider implements IWhatsappProvider {
  readonly name: Provider = 'EVOLUTION'
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: config.providers.evolution.url,
      headers: {
        apikey: config.providers.evolution.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    })
  }

  async sendText(instanceId: string, to: string, text: string): Promise<ProviderSendResult> {
    const start = Date.now()
    try {
      const response = await this.client.post(`/message/sendText/${instanceId}`, {
        number: to,
        text,
      })

      return {
        success: true,
        providerId: response.data?.key?.id,
        duration: Date.now() - start,
      }
    } catch (err: any) {
      return this.handleError(err, Date.now() - start)
    }
  }

  async sendMedia(
    instanceId: string,
    to: string,
    mediaUrl: string,
    caption?: string,
    type: MessageType = 'IMAGE'
  ): Promise<ProviderSendResult> {
    const start = Date.now()
    const typeMap: Record<string, string> = {
      IMAGE: 'sendMedia',
      VIDEO: 'sendMedia',
      AUDIO: 'sendWhatsAppAudio',
      DOCUMENT: 'sendMedia',
    }
    const endpoint = typeMap[type] ?? 'sendMedia'

    // Sem isso, a Evolution deriva o fileName sozinha quando mediatype=document —
    // e o jeito que ela faz isso é quebrado: a regex própria dela
    // (/.*\/(.+?)\./) pega tudo entre a última "/" e o PRIMEIRO "." depois, o
    // que corta a extensão fora (ex.: "orcamento-123.pdf" vira "orcamento-123",
    // sem ".pdf"). O mimetype continua certo (deriva da URL completa, não do
    // fileName truncado), mas o destinatário recebe um arquivo com tipo
    // "application/pdf" e NOME sem extensão — o WhatsApp/Android não consegue
    // decidir com que app abrir e mostra só um ícone genérico + "você talvez não
    // tenha um app adequado" (bug real, confirmado lendo o código-fonte dentro
    // do próprio container da Evolution API, 2026-08-10). Mandar o fileName
    // explícito (do último segmento da URL, que já tem a extensão certa)
    // contorna o bug sem depender de fix nenhum do lado da Evolution.
    const fileName = mediaUrl.split('/').pop()?.split('?')[0]

    try {
      const response = await this.client.post(`/message/${endpoint}/${instanceId}`, {
        number: to,
        mediatype: type.toLowerCase(),
        media: mediaUrl,
        caption: caption ?? '',
        ...(fileName ? { fileName } : {}),
      })

      return {
        success: true,
        providerId: response.data?.key?.id,
        duration: Date.now() - start,
      }
    } catch (err: any) {
      return this.handleError(err, Date.now() - start)
    }
  }

  async getInstanceStatus(instanceId: string): Promise<InstanceStatus> {
    try {
      const response = await this.client.get(`/instance/connectionState/${instanceId}`)
      const state = response.data?.instance?.state

      const stateMap: Record<string, InstanceStatus> = {
        open: 'connected',
        close: 'disconnected',
        connecting: 'qr_required',
      }

      return stateMap[state] ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  async createInstance(instanceId: string): Promise<{ instanceId: string; qrCode?: string }> {
    try {
      const response = await this.client.post('/instance/create', {
        instanceName: instanceId,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      })

      return {
        instanceId: response.data?.instance?.instanceName ?? instanceId,
        // POST /instance/create devolve o QR aninhado em qrcode.base64
        qrCode: response.data?.qrcode?.base64 ?? response.data?.base64,
      }
    } catch (err: any) {
      // Instância já existe (conflito) → reconecta para obter o QR atual
      const status = err?.response?.status
      if (status === 403 || status === 409) {
        const { qrCode } = await this.connect(instanceId)
        return { instanceId, qrCode }
      }
      throw err
    }
  }

  // GET /instance/connect/{id} → { base64 } ou { qrcode: { base64 } }
  async connect(instanceId: string): Promise<{ qrCode?: string }> {
    const response = await this.client.get(`/instance/connect/${instanceId}`)
    return {
      qrCode: response.data?.base64 ?? response.data?.qrcode?.base64,
    }
  }

  // Busca o QR atual sem recriar — usa o mesmo endpoint connect (idempotente)
  async getQr(instanceId: string): Promise<{ qrCode?: string }> {
    return this.connect(instanceId)
  }

  async deleteInstance(instanceId: string): Promise<void> {
    await this.client.delete(`/instance/delete/${instanceId}`)
  }

  // Registra o webhook inbound na Evolution. O formato mudou entre versões;
  // tentamos o formato v2 ({ webhook: { ... } }) e caímos no formato plano se houver erro.
  async setWebhook(instanceId: string, url: string): Promise<void> {
    // MESSAGES_UPSERT faltava aqui — sem ele a Evolution nunca chega a ENVIAR
    // o evento de mensagem recebida (cliente respondendo), então o parser de
    // mapEvolution() em inbound-status.service.ts nunca era nem acionado
    // (achado ao vivo 2026-09-28, confirmado via GET /webhook/find na própria
    // Evolution — só MESSAGES_UPDATE/CONNECTION_UPDATE/QRCODE_UPDATED estavam
    // inscritos). Instâncias já conectadas precisam reconectar (ou chamar
    // connect de novo) pra re-registrar o webhook com a lista corrigida.
    const events = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED']
    try {
      const resp = await this.client.post(`/webhook/set/${instanceId}`, {
        // base64: true garante que o evento QRCODE_UPDATED traga o QR já em base64.
        webhook: { enabled: true, url, webhookByEvents: false, base64: true, events },
      })
      logger.debug(`[Evolution] setWebhook ok (${instanceId}): ${JSON.stringify(resp.data)}`)
    } catch (err: any) {
      // Fallback para formato plano (algumas builds da v2.3.x)
      try {
        const resp = await this.client.post(`/webhook/set/${instanceId}`, {
          url,
          enabled: true,
          webhook_by_events: false,
          events,
        })
        logger.debug(`[Evolution] setWebhook ok (formato plano) (${instanceId}): ${JSON.stringify(resp.data)}`)
      } catch (err2: any) {
        const detail = err2?.response?.data ?? err2?.message
        throw new Error(`Evolution setWebhook falhou: ${JSON.stringify(detail)}`)
      }
    }
  }

  // Baixa a mídia de uma mensagem RECEBIDA (Evolution guarda a mensagem e
  // devolve o binário em base64). null = mensagem/mídia indisponível.
  async getMediaBase64(instanceId: string, providerMessageId: string): Promise<{ base64: string; mimetype?: string } | null> {
    try {
      const response = await this.client.post(
        `/chat/getBase64FromMediaMessage/${instanceId}`,
        { message: { key: { id: providerMessageId } }, convertToMp4: false },
        { timeout: 20000 },
      )
      const base64 = response.data?.base64
      if (typeof base64 !== 'string' || !base64) return null
      return { base64, mimetype: typeof response.data?.mimetype === 'string' ? response.data.mimetype : undefined }
    } catch (err: any) {
      logger.warn(`[Evolution] getMediaBase64 falhou (${instanceId}): ${err?.response?.status ?? err?.message}`)
      return null
    }
  }

  // ── Detecta se o erro indica banimento ───────────────────────
  isBanError(errorMsg: string): boolean {
    const banSignals = [
      'banned',
      'blocked',
      'unauthorized',
      '403',
      'Stream Errored',
      '515',
      'conflict',
    ]
    return banSignals.some(signal =>
      errorMsg.toLowerCase().includes(signal.toLowerCase())
    )
  }

  private handleError(err: any, duration: number): ProviderSendResult {
    const errorMsg = err?.response?.data?.message ?? err?.message ?? 'Unknown error'
    const errorCode = String(err?.response?.status ?? 'ERR')

    return {
      success: false,
      error: errorMsg,
      errorCode,
      duration,
    }
  }
}
