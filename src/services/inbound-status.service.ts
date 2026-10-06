// src/services/inbound-status.service.ts
// Parse TOLERANTE dos callbacks inbound de cada provider.
// Cada provider tem um formato de payload diferente; extraímos o `providerId`
// (ID da mensagem no provider) e mapeamos o status de entrega para MessageStatus.
import type { Provider, MessageStatus, InboundStatusUpdate, InboundMessage, InstanceConnState } from '../types'

// Ranking do funil de entrega — usado para garantir que o status só AVANÇA.
const STATUS_RANK: Record<string, number> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
}

// Retorna true se `next` é um avanço em relação a `current` no funil de entrega.
export function isStatusAdvance(current: MessageStatus, next: MessageStatus): boolean {
  const c = STATUS_RANK[current]
  const n = STATUS_RANK[next]
  // Se algum não estiver no funil (FAILED/CANCELLED/SCHEDULED), não sobrescreve.
  if (c === undefined || n === undefined) return false
  return n > c
}

// ── Evolution ─────────────────────────────────────────────────
// Eventos: messages.update / MESSAGES_UPDATE → status de entrega.
//          connection.update → connectionState. qrcode.updated → qrCode.
function mapEvolution(payload: any): InboundStatusUpdate | null {
  const event = String(payload?.event ?? payload?.type ?? '').toLowerCase()
  const data = payload?.data ?? payload

  // connection.update → estado de conexão
  if (event.includes('connection')) {
    const state = String(data?.state ?? data?.connection ?? '').toLowerCase()
    const connectionState = mapEvolutionConnState(state)
    return { providerId: '', connectionState }
  }

  // qrcode.updated → novo QR
  if (event.includes('qrcode')) {
    const qrCode = data?.qrcode?.base64 ?? data?.base64 ?? data?.qrcode
    return { providerId: '', qrCode: typeof qrCode === 'string' ? qrCode : undefined }
  }

  // messages.upsert → mensagem NOVA chegando (cliente respondendo), não
  // status de entrega de uma que a gente mandou. Formato Baileys/Evolution
  // padrão — ⚠️ NÃO verificado ainda contra payload real de produção (ao
  // contrário do parser do WuzAPI logo abaixo, que já foi — ver comentário
  // lá). Primeiro teste real depois de deployado precisa confirmar os nomes
  // de campo; se vier tudo undefined, é o formato exato que difere.
  if (event.includes('upsert')) {
    const msg = Array.isArray(data) ? data[0] : data
    const key = msg?.key ?? {}
    const remoteJid = String(key.remoteJid ?? '')
    const from = remoteJid.replace(/@s\.whatsapp\.net$|@lid$|@g\.us$/, '')
    const fromMe = Boolean(key.fromMe)
    const content = msg?.message ?? {}
    const media = evolutionMedia(content)
    const text =
      content.conversation ??
      content.extendedTextMessage?.text ??
      content.buttonsResponseMessage?.selectedDisplayText ??
      content.listResponseMessage?.title ??
      media?.caption
    const providerMessageId = key.id
    if (!remoteJid) return null
    return {
      providerId: '',
      inboundMessage: {
        from,
        fromMe,
        mediaType: media?.mediaType,
        mimetype: media?.mimetype,
        mediaBase64: typeof content.base64 === 'string' ? content.base64 : undefined,
        text: typeof text === 'string' ? text : undefined,
        buttonText:
          typeof content.buttonsResponseMessage?.selectedDisplayText === 'string'
            ? content.buttonsResponseMessage.selectedDisplayText
            : undefined,
        listRowId:
          typeof content.listResponseMessage?.singleSelectReply?.selectedRowId === 'string'
            ? content.listResponseMessage.singleSelectReply.selectedRowId
            : undefined,
        listTitle:
          typeof content.listResponseMessage?.title === 'string' ? content.listResponseMessage.title : undefined,
        providerMessageId: typeof providerMessageId === 'string' ? providerMessageId : undefined,
      },
    }
  }

  // messages.update (default) → status de entrega
  const providerId = data?.keyId ?? data?.key?.id ?? data?.id
  const rawStatus = String(data?.status ?? data?.update?.status ?? '').toUpperCase()
  const status = mapEvolutionAck(rawStatus)
  if (!providerId) return null
  return { providerId: String(providerId), status }
}

// Mídia numa mensagem recebida (Baileys): cada tipo vem no próprio campo *Message.
// Legenda (caption) de imagem/vídeo/documento entra como texto da mensagem.
const EVOLUTION_MEDIA_FIELDS = [
  ['audioMessage', 'audio'],
  ['imageMessage', 'image'],
  ['stickerMessage', 'sticker'],
  ['videoMessage', 'video'],
  ['documentMessage', 'document'],
] as const

function evolutionMedia(
  content: any,
): { mediaType: NonNullable<InboundMessage['mediaType']>; mimetype?: string; caption?: string } | undefined {
  for (const [field, mediaType] of EVOLUTION_MEDIA_FIELDS) {
    const m = content?.[field]
    if (m && typeof m === 'object') {
      return {
        mediaType,
        mimetype: typeof m.mimetype === 'string' ? m.mimetype : undefined,
        caption: typeof m.caption === 'string' ? m.caption : undefined,
      }
    }
  }
  return undefined
}

function mapEvolutionAck(raw: string): MessageStatus | undefined {
  switch (raw) {
    case 'DELIVERY_ACK':
      return 'DELIVERED'
    case 'READ':
    case 'PLAYED':
      return 'READ'
    case 'SERVER_ACK':
    case 'SENT':
      return 'SENT'
    default:
      return undefined
  }
}

function mapEvolutionConnState(state: string): InstanceConnState | undefined {
  switch (state) {
    case 'open':
      return 'CONNECTED'
    case 'close':
      return 'DISCONNECTED'
    case 'connecting':
      return 'QR_PENDING'
    default:
      return undefined
  }
}

// ── Cloud API ─────────────────────────────────────────────────
// Estrutura: entry[].changes[].value.statuses[] com { id, status: sent|delivered|read }.
function mapCloudApi(payload: any): InboundStatusUpdate | null {
  const statuses =
    payload?.entry?.[0]?.changes?.[0]?.value?.statuses ??
    payload?.statuses
  const st = Array.isArray(statuses) ? statuses[0] : undefined
  if (!st) return null
  const providerId = st?.id
  const status = mapCloudApiStatus(String(st?.status ?? '').toLowerCase())
  if (!providerId) return null
  return { providerId: String(providerId), status }
}

function mapCloudApiStatus(raw: string): MessageStatus | undefined {
  switch (raw) {
    case 'sent':
      return 'SENT'
    case 'delivered':
      return 'DELIVERED'
    case 'read':
      return 'READ'
    default:
      return undefined
  }
}

// ── WuzAPI ────────────────────────────────────────────────────
// PARTICULARIDADE (confirmado capturando webhook real + source wmiau.go): o WuzAPI
// entrega o webhook como form-urlencoded, não JSON. O corpo chega como
//   { instanceName, jsonData: '<string JSON do evento>', userID }
// e o evento de verdade está DENTRO de jsonData. Desembrulhamos aqui.
//
// Evento (jsonData): { type, ... }
//   - "QR"                       → qrCodeBase64 (data URI PNG) no topo do evento
//   - "Connected" / "PairSuccess"→ conexão estabelecida
//   - "Disconnected"/"LoggedOut" → desconectado
//   - "ReadReceipt"              → state ("Delivered"|"Read"|"ReadSelf") + event.MessageIDs[]
function mapWuzapi(payload: any): InboundStatusUpdate | null {
  // Desembrulha o wrapper form-encoded (jsonData string). Se já vier desembrulhado
  // (payload.type presente), usa direto — defensivo.
  let evt: any = payload
  if (typeof payload?.jsonData === 'string') {
    try {
      evt = JSON.parse(payload.jsonData)
    } catch {
      return null
    }
  }

  const type = String(evt?.type ?? '').toLowerCase()

  // Conexão / sessão
  if (type === 'connected' || type === 'pairsuccess') {
    return { providerId: '', connectionState: 'CONNECTED' }
  }
  if (type === 'disconnected' || type === 'loggedout') {
    return { providerId: '', connectionState: 'DISCONNECTED' }
  }

  // QR — já vem como data URI PNG
  if (type === 'qr') {
    const qr = evt?.qrCodeBase64
    return { providerId: '', qrCode: typeof qr === 'string' ? qr : undefined }
  }

  // Recibo de entrega/leitura
  if (type === 'readreceipt') {
    const status = mapWuzapiReceipt(String(evt?.state ?? ''))
    // MVP (Opção A): um ReadReceipt pode confirmar VÁRIAS mensagens (MessageIDs[]),
    // mas InboundStatusUpdate carrega um providerId só. Usamos o primeiro (a maioria
    // dos recibos é de 1 mensagem). Processar o array inteiro exigiria mudar o tipo
    // e as duas rotas inbound — fica como melhoria futura.
    const ids = evt?.event?.MessageIDs
    const providerId = Array.isArray(ids) ? ids[0] : undefined
    if (!providerId || !status) return null
    return { providerId: String(providerId), status }
  }

  // Message inbound (cliente respondendo, inclusive clique de botão/lista).
  //
  // ✅ VERIFICADO CONTRA DOIS PAYLOADS REAIS (2026-08-10): primeiro um eco da
  // própria sessão (IsFromMe=true, telefone saindo de RecipientAlt), depois
  // um clique de CLIENTE de verdade (IsFromMe=false, telefone saindo de
  // SenderAlt) — os dois ramos abaixo estão confirmados, nenhum é dedução.
  // O que os payloads mostraram, e que desmentiu a convenção assumida antes:
  //
  //   1. O campo é `selectedRowID` (ID maiúsculo no fim, s minúsculo no
  //      início) — não `selectedRowId`. Errar isso não dá erro nenhum: só
  //      devolve undefined e a resposta do cliente some.
  //   2. `Info.Sender` vem como **LID** ("129626542202894@lid"), não como
  //      telefone. O número real vem de `SenderAlt` quando é o cliente
  //      respondendo, ou de `RecipientAlt` quando é eco da própria sessão.
  //      Cortar o "@" do Sender produz um identificador interno do WhatsApp
  //      que não casa com telefone nenhum.
  if (type === 'message') {
    const info = evt?.event?.Info ?? evt?.event?.info ?? evt?.Info ?? {}
    const fromMe = info.IsFromMe === true || info.isFromMe === true

    // Só o JID @s.whatsapp.net carrega telefone; @lid é identificador interno.
    const telefoneDe = (jid: unknown): string => {
      const s = String(jid ?? '')
      return s.includes('@s.whatsapp.net') ? s.split('@')[0].split(':')[0] : ''
    }

    const sender = info.Sender ?? info.sender ?? ''
    const senderAlt = info.SenderAlt ?? info.senderAlt ?? ''
    const recipientAlt = info.RecipientAlt ?? info.recipientAlt ?? ''

    // Quem é a "outra ponta" da conversa: normalmente quem respondeu
    // (SenderAlt/Sender). Quando IsFromMe, o evento é eco da nossa própria
    // sessão e o contato é o destinatário (RecipientAlt).
    const from =
      telefoneDe(senderAlt) ||
      telefoneDe(sender) ||
      (fromMe ? telefoneDe(recipientAlt) : '') ||
      ''

    const lid = String(sender).includes('@lid') ? String(sender).split('@')[0] : undefined
    if (!from && !lid) return null

    const msg = evt?.event?.Message ?? evt?.event?.message ?? evt?.Message
    const btn = msg?.buttonsResponseMessage ?? msg?.ButtonsResponseMessage
    const buttonText = btn?.selectedDisplayText ?? btn?.SelectedDisplayText
    const text = msg?.conversation ?? msg?.extendedTextMessage?.text

    // Escolha numa lista interativa (type=LIST). O que importa é o rowID: é o
    // identificador que NÓS definimos ao montar o menu, e o único campo que diz
    // sem ambiguidade a que a resposta se refere — o título é rótulo visual e
    // pode se repetir entre mensagens diferentes.
    const lst = msg?.listResponseMessage ?? msg?.ListResponseMessage
    const single = lst?.singleSelectReply ?? lst?.SingleSelectReply
    const rowId =
      single?.selectedRowID ?? single?.selectedRowId ?? single?.SelectedRowID ?? single?.SelectedRowId
    const listTitle = lst?.title ?? lst?.Title

    const providerId = info.ID ?? info.id ?? undefined

    return {
      providerId: '',
      inboundMessage: {
        from,
        fromLid: lid,
        fromMe,
        buttonText: typeof buttonText === 'string' ? buttonText : undefined,
        listRowId: typeof rowId === 'string' ? rowId : undefined,
        listTitle: typeof listTitle === 'string' ? listTitle : undefined,
        text: typeof text === 'string' ? text : undefined,
        providerMessageId: typeof providerId === 'string' ? providerId : undefined,
      },
    }
  }

  // Presence, HistorySync, etc. → ignorado.
  return null
}

function mapWuzapiReceipt(state: string): MessageStatus | undefined {
  switch (state) {
    case 'Delivered':
      return 'DELIVERED'
    case 'Read':
    case 'ReadSelf':
      return 'READ'
    default:
      return undefined
  }
}

// ── Dispatcher ────────────────────────────────────────────────
// Recebe o provider (já normalizado para o enum) e o payload bruto; retorna o update
// parseado ou null se o payload não puder ser interpretado.
export function mapInboundStatus(provider: Provider, payload: any): InboundStatusUpdate | null {
  try {
    switch (provider) {
      case 'EVOLUTION':
        return mapEvolution(payload)
      case 'WUZAPI':
        return mapWuzapi(payload)
      case 'CLOUD_API':
        return mapCloudApi(payload)
      default:
        return null
    }
  } catch {
    return null
  }
}

// Normaliza o param :provider da rota (case-insensitive) para o enum Provider.
export function normalizeProvider(raw: string): Provider | null {
  switch (raw.toLowerCase()) {
    case 'evolution':
      return 'EVOLUTION'
    case 'wuzapi':
      return 'WUZAPI'
    case 'cloud_api':
    case 'cloudapi':
    case 'cloud-api':
      return 'CLOUD_API'
    default:
      return null
  }
}
