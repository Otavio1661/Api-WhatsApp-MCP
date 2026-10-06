// src/schemas/webhook-events.test.ts
// Trava a lista de eventos de webhook: API (webhooks.route.ts) e painel
// (panel.route.ts) importam WEBHOOK_EVENTS daqui, então um evento adicionado/
// removido aqui já reflete nos dois lugares sem precisar tocar nada mais.
import { describe, it, expect } from 'vitest'
import { WEBHOOK_EVENTS } from './webhook-events'

describe('WEBHOOK_EVENTS', () => {
  it('inclui todos os eventos suportados, inclusive MESSAGE_RECEIVED', () => {
    expect(WEBHOOK_EVENTS).toEqual([
      'BAN_DETECTED',
      'NUMBER_ROTATED',
      'NUMBER_DISCONNECTED',
      'MESSAGE_FAILED',
      'MESSAGE_DELIVERED',
      'MESSAGE_RECEIVED',
      'PROVIDER_DOWN',
    ])
  })

  it('não tem eventos duplicados', () => {
    expect(new Set(WEBHOOK_EVENTS).size).toBe(WEBHOOK_EVENTS.length)
  })
})
