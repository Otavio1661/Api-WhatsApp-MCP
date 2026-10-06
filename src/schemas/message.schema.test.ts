// src/schemas/message.schema.test.ts
// Testes unitários da validação zod compartilhada pelas duas superfícies de envio.
import { describe, it, expect } from 'vitest'
import { sendBodySchema } from './message.schema'

const base = { to: '5544999990000' }

describe('sendBodySchema', () => {
  it('TEXT válido passa', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'TEXT', text: 'oi' })
    expect(r.success).toBe(true)
  })

  it('TEXT sem text falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'TEXT' })
    expect(r.success).toBe(false)
  })

  it('TEXT com text vazio falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'TEXT', text: '' })
    expect(r.success).toBe(false)
  })

  it('TEXT com text só espaços falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'TEXT', text: '   ' })
    expect(r.success).toBe(false)
  })

  it('sem "type" (default TEXT) e sem "text" falha', () => {
    const r = sendBodySchema.safeParse({ ...base })
    expect(r.success).toBe(false)
  })

  it('mídia sem mediaUrl falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'IMAGE' })
    expect(r.success).toBe(false)
  })

  it('mídia com mediaUrl passa (inclui STICKER)', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'STICKER', mediaUrl: 'https://exemplo.com/f.webp' })
    expect(r.success).toBe(true)
  })

  it('BUTTONS válido (1-3 quickreply + url + call) passa', () => {
    const r = sendBodySchema.safeParse({
      ...base, type: 'BUTTONS', text: 'Escolha uma opção',
      buttons: [
        { type: 'quickreply', displayText: 'Sim' },
        { type: 'quickreply', displayText: 'Não' },
        { type: 'url', displayText: 'Site', url: 'https://exemplo.com' },
        { type: 'call', displayText: 'Ligar', phoneNumber: '5544999990000' },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('BUTTONS com 4 quickreply falha (máx 3)', () => {
    const r = sendBodySchema.safeParse({
      ...base, type: 'BUTTONS', text: 'oi',
      buttons: [
        { type: 'quickreply', displayText: 'A' },
        { type: 'quickreply', displayText: 'B' },
        { type: 'quickreply', displayText: 'C' },
        { type: 'quickreply', displayText: 'D' },
      ],
    })
    expect(r.success).toBe(false)
  })

  it('BUTTONS sem text falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'BUTTONS', buttons: [{ type: 'quickreply', displayText: 'Sim' }] })
    expect(r.success).toBe(false)
  })

  it('LOCATION com latitude/longitude passa', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'LOCATION', latitude: -23.5, longitude: -46.6 })
    expect(r.success).toBe(true)
  })

  it('LOCATION sem coordenadas falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'LOCATION', locationName: 'Escritório' })
    expect(r.success).toBe(false)
  })

  it('LOCATION com latitude fora do range falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'LOCATION', latitude: 200, longitude: -46.6 })
    expect(r.success).toBe(false)
  })

  it('CONTACT com nome e telefone passa', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'CONTACT', contactName: 'Fulano', contactPhone: '5544988880000' })
    expect(r.success).toBe(true)
  })

  it('CONTACT sem telefone falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'CONTACT', contactName: 'Fulano' })
    expect(r.success).toBe(false)
  })

  it('POLL com pergunta e 2+ opções passa', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'POLL', text: 'Qual sua cor favorita?', pollOptions: ['Azul', 'Verde'] })
    expect(r.success).toBe(true)
  })

  it('POLL com só 1 opção falha (mínimo 2)', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'POLL', text: 'Pergunta?', pollOptions: ['Única'] })
    expect(r.success).toBe(false)
  })

  it('POLL com 13 opções falha (máximo 12)', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'POLL', text: 'Pergunta?', pollOptions: Array.from({ length: 13 }, (_, i) => `Opção ${i}`) })
    expect(r.success).toBe(false)
  })

  it('POLL sem pergunta falha', () => {
    const r = sendBodySchema.safeParse({ ...base, type: 'POLL', pollOptions: ['A', 'B'] })
    expect(r.success).toBe(false)
  })
})

describe('type=LIST', () => {
  const base = {
    to: '5544977770013',
    type: 'LIST' as const,
    text: 'Escolha a forma de pagamento',
    listButtonText: 'Escolher',
    listSections: [
      {
        title: 'Pagamento',
        rows: [
          { title: 'Pix', rowId: 'pag:pix:28' },
          { title: 'Dinheiro', rowId: 'pag:dinheiro:28' },
        ],
      },
    ],
  }

  it('aceita lista válida', () => {
    expect(sendBodySchema.safeParse(base).success).toBe(true)
  })

  it('aceita mais de 3 opções (o que BUTTONS não permite)', () => {
    const cinco = {
      ...base,
      listSections: [
        {
          title: 'Pagamento',
          rows: [
            { title: 'Crédito', rowId: 'pag:cartao_credito:28' },
            { title: 'Débito', rowId: 'pag:cartao_debito:28' },
            { title: 'Pix', rowId: 'pag:pix:28' },
            { title: 'Dinheiro', rowId: 'pag:dinheiro:28' },
            { title: 'Recusar', rowId: 'pag:recusar:28' },
          ],
        },
      ],
    }
    expect(sendBodySchema.safeParse(cinco).success).toBe(true)
  })

  it('rejeita sem listButtonText', () => {
    const { listButtonText, ...sem } = base
    expect(sendBodySchema.safeParse(sem).success).toBe(false)
  })

  it('rejeita rowId duplicado (resposta ficaria ambígua)', () => {
    const dup = {
      ...base,
      listSections: [
        {
          title: 'Pagamento',
          rows: [
            { title: 'Pix', rowId: 'mesmo' },
            { title: 'Dinheiro', rowId: 'mesmo' },
          ],
        },
      ],
    }
    expect(sendBodySchema.safeParse(dup).success).toBe(false)
  })

  it('rejeita mais de 10 linhas somando as seções', () => {
    const linha = (i: number) => ({ title: `Op ${i}`, rowId: `r${i}` })
    const demais = {
      ...base,
      listSections: [
        { title: 'A', rows: Array.from({ length: 6 }, (_, i) => linha(i)) },
        { title: 'B', rows: Array.from({ length: 6 }, (_, i) => linha(i + 100)) },
      ],
    }
    expect(sendBodySchema.safeParse(demais).success).toBe(false)
  })
})
