// src/services/inbound-status.service.test.ts
// Testes unitários das funções puras de parse/avanço de status inbound.
import { describe, it, expect } from 'vitest'
import { mapInboundStatus, isStatusAdvance } from './inbound-status.service'

describe('mapInboundStatus', () => {
  // ── Evolution ───────────────────────────────────────────────
  it('mapeia ack de entrega da Evolution (DELIVERY_ACK → DELIVERED)', () => {
    const update = mapInboundStatus('EVOLUTION', {
      event: 'messages.update',
      data: { keyId: 'EVO-123', status: 'DELIVERY_ACK' },
    })
    expect(update).toEqual({ providerId: 'EVO-123', status: 'DELIVERED' })
  })

  it('mapeia READ da Evolution e extrai providerId de key.id', () => {
    const update = mapInboundStatus('EVOLUTION', {
      event: 'MESSAGES_UPDATE',
      data: { key: { id: 'EVO-READ' }, status: 'READ' },
    })
    expect(update).toEqual({ providerId: 'EVO-READ', status: 'READ' })
  })

  it('mapeia evento de conexão da Evolution (open → CONNECTED)', () => {
    const update = mapInboundStatus('EVOLUTION', {
      event: 'connection.update',
      data: { state: 'open' },
    })
    expect(update).toEqual({ providerId: '', connectionState: 'CONNECTED' })
  })

  it('retorna null quando não há providerId num messages.update', () => {
    const update = mapInboundStatus('EVOLUTION', {
      event: 'messages.update',
      data: { status: 'DELIVERY_ACK' },
    })
    expect(update).toBeNull()
  })

  it('mapeia messages.upsert da Evolution (texto simples do cliente)', () => {
    const update = mapInboundStatus('EVOLUTION', {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5544999990000@s.whatsapp.net', fromMe: false, id: 'EVO-IN-1' },
        message: { conversation: 'oi, recebi sua mensagem' },
      },
    })
    expect(update).toEqual({
      providerId: '',
      inboundMessage: {
        from: '5544999990000',
        fromMe: false,
        text: 'oi, recebi sua mensagem',
        buttonText: undefined,
        listRowId: undefined,
        listTitle: undefined,
        providerMessageId: 'EVO-IN-1',
      },
    })
  })

  it('messages.upsert de áudio da Evolution: mediaType, mimetype e base64 em trânsito, sem text', () => {
    const update = mapInboundStatus('EVOLUTION', {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '554499990000@s.whatsapp.net', fromMe: true, id: 'AUD1' },
        message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 3 }, base64: 'QUJD' },
      },
    })
    expect(update?.inboundMessage).toMatchObject({
      mediaType: 'audio',
      mimetype: 'audio/ogg; codecs=opus',
      mediaBase64: 'QUJD',
      fromMe: true,
    })
    expect(update?.inboundMessage?.text).toBeUndefined()
  })

  it('messages.upsert de imagem/figurinha: legenda vira text, tipo é reconhecido', () => {
    const img = mapInboundStatus('EVOLUTION', {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5544@s.whatsapp.net', id: 'IMG1' },
        message: { imageMessage: { mimetype: 'image/jpeg', caption: 'olha isso' } },
      },
    })
    expect(img?.inboundMessage).toMatchObject({ mediaType: 'image', mimetype: 'image/jpeg', text: 'olha isso' })

    const st = mapInboundStatus('EVOLUTION', {
      event: 'messages.upsert',
      data: { key: { remoteJid: '5544@s.whatsapp.net', id: 'ST1' }, message: { stickerMessage: { mimetype: 'image/webp' } } },
    })
    expect(st?.inboundMessage).toMatchObject({ mediaType: 'sticker', mimetype: 'image/webp' })
    expect(st?.inboundMessage?.text).toBeUndefined()
  })

  it('mapeia messages.upsert da Evolution vindo como array (data[0])', () => {
    const update = mapInboundStatus('EVOLUTION', {
      event: 'messages.upsert',
      data: [{ key: { remoteJid: '5544999990000@s.whatsapp.net', fromMe: false, id: 'EVO-IN-2' }, message: { extendedTextMessage: { text: 'resposta longa' } } }],
    })
    expect(update?.inboundMessage?.text).toBe('resposta longa')
  })

  it('ignora eco da própria sessão (fromMe=true) só marcando fromMe, não descarta', () => {
    const update = mapInboundStatus('EVOLUTION', {
      event: 'messages.upsert',
      data: { key: { remoteJid: '5544999990000@s.whatsapp.net', fromMe: true, id: 'EVO-ECHO' }, message: { conversation: 'eco' } },
    })
    expect(update?.inboundMessage?.fromMe).toBe(true)
  })

  it('messages.upsert sem remoteJid → null', () => {
    const update = mapInboundStatus('EVOLUTION', { event: 'messages.upsert', data: { key: {}, message: {} } })
    expect(update).toBeNull()
  })

  // ── Cloud API ───────────────────────────────────────────────
  it('mapeia statuses[] da Cloud API (delivered → DELIVERED)', () => {
    const update = mapInboundStatus('CLOUD_API', {
      entry: [
        { changes: [{ value: { statuses: [{ id: 'WAMID-1', status: 'delivered' }] } }] },
      ],
    })
    expect(update).toEqual({ providerId: 'WAMID-1', status: 'DELIVERED' })
  })

  it('retorna null para Cloud API sem statuses', () => {
    const update = mapInboundStatus('CLOUD_API', { entry: [{ changes: [{ value: {} }] }] })
    expect(update).toBeNull()
  })

  // ── WuzAPI ──────────────────────────────────────────────────
  // Formato REAL (capturado): form-encoded com o evento dentro de `jsonData` (string).
  const wuz = (evt: object) => ({ instanceName: 'inst', jsonData: JSON.stringify(evt), userID: 'u1' })

  it('mapeia ReadReceipt Delivered da WuzAPI (event.MessageIDs[0])', () => {
    const update = mapInboundStatus('WUZAPI', wuz({
      type: 'ReadReceipt', state: 'Delivered', event: { MessageIDs: ['WUZ-1', 'WUZ-2'] },
    }))
    expect(update).toEqual({ providerId: 'WUZ-1', status: 'DELIVERED' })
  })

  it('mapeia ReadReceipt Read da WuzAPI (Read → READ)', () => {
    const update = mapInboundStatus('WUZAPI', wuz({
      type: 'ReadReceipt', state: 'Read', event: { MessageIDs: ['WUZ-3'] },
    }))
    expect(update).toEqual({ providerId: 'WUZ-3', status: 'READ' })
  })

  it('mapeia Connected da WuzAPI (→ CONNECTED)', () => {
    const update = mapInboundStatus('WUZAPI', wuz({ type: 'Connected', event: {} }))
    expect(update).toEqual({ providerId: '', connectionState: 'CONNECTED' })
  })

  it('mapeia LoggedOut da WuzAPI (→ DISCONNECTED)', () => {
    const update = mapInboundStatus('WUZAPI', wuz({ type: 'LoggedOut', event: {} }))
    expect(update).toEqual({ providerId: '', connectionState: 'DISCONNECTED' })
  })

  it('mapeia QR da WuzAPI (qrCodeBase64 → qrCode)', () => {
    const update = mapInboundStatus('WUZAPI', wuz({ type: 'QR', qrCodeBase64: 'data:image/png;base64,ABC' }))
    expect(update).toEqual({ providerId: '', qrCode: 'data:image/png;base64,ABC' })
  })

  it('retorna null para evento irrelevante da WuzAPI (Presence)', () => {
    const update = mapInboundStatus('WUZAPI', wuz({ type: 'Presence', event: {} }))
    expect(update).toBeNull()
  })

  it('retorna null para ReadReceipt da WuzAPI sem MessageIDs', () => {
    const update = mapInboundStatus('WUZAPI', wuz({ type: 'ReadReceipt', state: 'Delivered', event: {} }))
    expect(update).toBeNull()
  })

  // ── Resposta de lista interativa (type=LIST) ────────────────
  // Payload REAL capturado de um toque de verdade (2026-08-10), reduzido aos
  // campos que o parser lê. Guardado assim de propósito: a versão anterior
  // destes testes foi escrita "por convenção" e passava com os nomes ERRADOS
  // (selectedRowId em vez de selectedRowID), dando falsa confiança num
  // caminho que na prática devolvia undefined.
  it('extrai o rowID escolhido numa lista (payload real)', () => {
    const update = mapInboundStatus('WUZAPI', wuz({
      type: 'Message',
      event: {
        Info: {
          Chat: '22754854219890@lid',
          Sender: '129626542202894@lid',
          SenderAlt: '',
          RecipientAlt: '554477770013@s.whatsapp.net',
          IsFromMe: true,
          ID: 'AC1ADFA4AB8839EF549C6D4A4A8B76FC',
          MediaType: 'list_response',
        },
        Message: {
          listResponseMessage: {
            title: 'Pix',
            listType: 1,
            singleSelectReply: { selectedRowID: 'pag:pix:28' },
          },
        },
      },
    }))
    expect(update?.inboundMessage?.listRowId).toBe('pag:pix:28')
    expect(update?.inboundMessage?.listTitle).toBe('Pix')
    // Sender é @lid: o telefone tem que sair do RecipientAlt (é eco da própria
    // sessão), nunca de cortar o "@" do LID.
    expect(update?.inboundMessage?.from).toBe('554477770013')
    expect(update?.inboundMessage?.fromLid).toBe('129626542202894')
    expect(update?.inboundMessage?.fromMe).toBe(true)
  })

  // Payload REAL de um cliente de verdade respondendo (não eco da própria
  // sessão) — capturado 2026-08-10 pedindo pra outra pessoa (fora da conta
  // dona da instância) tocar numa lista de teste de verdade.
  it('usa SenderAlt como telefone quando quem responde é o cliente (payload real)', () => {
    const update = mapInboundStatus('WUZAPI', wuz({
      type: 'Message',
      event: {
        Info: {
          Sender: '22754854219890@lid',
          SenderAlt: '554477770013@s.whatsapp.net',
          RecipientAlt: '',
          IsFromMe: false,
        },
        Message: {
          listResponseMessage: {
            title: 'Cartao de credito',
            singleSelectReply: { selectedRowID: 'pag:cartao_credito:teste' },
          },
        },
      },
    }))
    expect(update?.inboundMessage?.listRowId).toBe('pag:cartao_credito:teste')
    expect(update?.inboundMessage?.from).toBe('554477770013')
    expect(update?.inboundMessage?.fromMe).toBe(false)
  })

  it('nunca usa o LID como se fosse telefone', () => {
    const update = mapInboundStatus('WUZAPI', wuz({
      type: 'Message',
      event: {
        Info: { Sender: '129626542202894@lid', SenderAlt: '', IsFromMe: false },
        Message: { conversation: 'oi' },
      },
    }))
    expect(update?.inboundMessage?.from).toBe('')
    expect(update?.inboundMessage?.fromLid).toBe('129626542202894')
  })

  it('mensagem de texto comum não vira escolha de lista', () => {
    const update = mapInboundStatus('WUZAPI', wuz({
      type: 'Message',
      event: {
        Info: { Sender: '554477770013@s.whatsapp.net', IsFromMe: false },
        Message: { conversation: 'oi' },
      },
    }))
    expect(update?.inboundMessage?.listRowId).toBeUndefined()
    expect(update?.inboundMessage?.text).toBe('oi')
    expect(update?.inboundMessage?.from).toBe('554477770013')
  })

  // ── Provider inválido ───────────────────────────────────────
  it('retorna null para provider inválido', () => {
    // @ts-expect-error — força um provider fora do enum para validar o default.
    const update = mapInboundStatus('INVALIDO', { foo: 'bar' })
    expect(update).toBeNull()
  })

  it('retorna null (sem lançar) quando o payload quebra o parse', () => {
    // payload null não deve estourar exceção — o dispatcher tem try/catch.
    const update = mapInboundStatus('EVOLUTION', null)
    expect(update).toBeNull()
  })
})

describe('isStatusAdvance', () => {
  it('avança SENT → DELIVERED', () => {
    expect(isStatusAdvance('SENT', 'DELIVERED')).toBe(true)
  })

  it('avança DELIVERED → READ', () => {
    expect(isStatusAdvance('DELIVERED', 'READ')).toBe(true)
  })

  it('NÃO retrocede READ → DELIVERED', () => {
    expect(isStatusAdvance('READ', 'DELIVERED')).toBe(false)
  })

  it('NÃO retrocede DELIVERED → SENT', () => {
    expect(isStatusAdvance('DELIVERED', 'SENT')).toBe(false)
  })

  it('NÃO considera avanço para o mesmo status', () => {
    expect(isStatusAdvance('SENT', 'SENT')).toBe(false)
  })

  it('ignora status fora do funil (FAILED não sobrescreve)', () => {
    expect(isStatusAdvance('SENT', 'FAILED')).toBe(false)
    expect(isStatusAdvance('FAILED', 'READ')).toBe(false)
  })
})
