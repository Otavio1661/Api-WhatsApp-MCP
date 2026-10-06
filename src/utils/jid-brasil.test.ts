// src/utils/jid-brasil.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Redis mockado: o módulo usa cache, mas a regra não deve depender dele.
const store = new Map<string, string>()
vi.mock('./redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v)
      return 'OK'
    }),
  },
}))

import { resolverDestino, ehDestinoLiteral, telefoneDoJid } from './jid-brasil'

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe('telefoneDoJid', () => {
  it('extrai o telefone de um JID completo', () => {
    expect(telefoneDoJid('554477770013@s.whatsapp.net')).toBe('554477770013')
  })

  it('ignora o sufixo de dispositivo (:42)', () => {
    expect(telefoneDoJid('554466660042:42@s.whatsapp.net')).toBe('554466660042')
  })
})

describe('ehDestinoLiteral', () => {
  it('reconhece grupo e JID já endereçado', () => {
    expect(ehDestinoLiteral('12036304@g.us')).toBe(true)
    expect(ehDestinoLiteral('554477770013@s.whatsapp.net')).toBe(true)
  })

  it('número cru não é literal', () => {
    expect(ehDestinoLiteral('5544977770013')).toBe(false)
  })
})

describe('resolverDestino', () => {
  it('converte o formato COM 9 para o real SEM 9 (conta antiga)', async () => {
    const consultar = vi.fn().mockResolvedValue([
      { phone: '5544977770013', existsOnWhatsapp: true, jid: '554477770013@s.whatsapp.net' },
    ])
    const r = await resolverDestino('5544977770013', consultar)
    expect(r.telefone).toBe('554477770013')
    expect(r.existeNoWhatsapp).toBe(true)
  })

  it('converte o formato SEM 9 para o real COM 9 (conta nova) — os dois sentidos', async () => {
    const consultar = vi.fn().mockResolvedValue([
      { phone: '554477770013', existsOnWhatsapp: true, jid: '5544977770013@s.whatsapp.net' },
    ])
    const r = await resolverDestino('554477770013', consultar)
    expect(r.telefone).toBe('5544977770013')
  })

  it('aceita número com máscara e devolve só dígitos', async () => {
    const consultar = vi.fn().mockResolvedValue([
      { phone: '5544977770013', existsOnWhatsapp: true, jid: '554477770013@s.whatsapp.net' },
    ])
    const r = await resolverDestino('+55 (44) 97777-0013', consultar)
    expect(r.telefone).toBe('554477770013')
  })

  it('marca número sem WhatsApp para o envio falhar explícito', async () => {
    const consultar = vi.fn().mockResolvedValue([
      { phone: '5544000000000', existsOnWhatsapp: false },
    ])
    const r = await resolverDestino('5544000000000', consultar)
    expect(r.existeNoWhatsapp).toBe(false)
  })

  it('não consulta nada para grupo (@g.us) — passa intacto', async () => {
    const consultar = vi.fn()
    const r = await resolverDestino('12036304@g.us', consultar)
    expect(r.telefone).toBe('12036304@g.us')
    expect(consultar).not.toHaveBeenCalled()
  })

  it('usa cache na segunda chamada em vez de consultar de novo', async () => {
    const consultar = vi.fn().mockResolvedValue([
      { phone: '5544977770013', existsOnWhatsapp: true, jid: '554477770013@s.whatsapp.net' },
    ])
    await resolverDestino('5544977770013', consultar)
    const segunda = await resolverDestino('5544977770013', consultar)
    expect(consultar).toHaveBeenCalledTimes(1)
    expect(segunda.telefone).toBe('554477770013')
    expect(segunda.doCache).toBe(true)
  })

  it('cacheia também o "não tem WhatsApp" sem confundir com cache vazio', async () => {
    const consultar = vi.fn().mockResolvedValue([
      { phone: '5544000000000', existsOnWhatsapp: false },
    ])
    await resolverDestino('5544000000000', consultar)
    const segunda = await resolverDestino('5544000000000', consultar)
    expect(consultar).toHaveBeenCalledTimes(1)
    expect(segunda.existeNoWhatsapp).toBe(false)
  })

  it('se a consulta falhar, envia com o número original em vez de bloquear', async () => {
    const consultar = vi.fn().mockRejectedValue(new Error('WuzAPI fora do ar'))
    const r = await resolverDestino('5544977770013', consultar)
    expect(r.telefone).toBe('5544977770013')
    expect(r.existeNoWhatsapp).toBe(true)
  })
})
