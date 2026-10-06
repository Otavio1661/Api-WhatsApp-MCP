// src/schemas/webhook-events.ts
// Fonte única de verdade dos eventos de webhook suportados pela plataforma.
// Antes desta extração, a lista existia duplicada em dois lugares (schema
// zod da API em src/routes/webhooks.route.ts e checkboxes do painel em
// src/web/panel.route.ts) e divergiu: o painel ficou sem MESSAGE_RECEIVED.
// Qualquer evento novo (ou removido) deve mudar SÓ aqui — API, painel e o
// tipo WebhookEvent (src/types/index.ts) importam daqui.
export const WEBHOOK_EVENTS = [
  'BAN_DETECTED',
  'NUMBER_ROTATED',
  'NUMBER_DISCONNECTED',
  'MESSAGE_FAILED',
  'MESSAGE_DELIVERED',
  'MESSAGE_RECEIVED',
  'PROVIDER_DOWN',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]
