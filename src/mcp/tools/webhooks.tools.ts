// src/mcp/tools/webhooks.tools.ts
// Espelha src/routes/webhooks.route.ts (CRUD do tenant, authManage) via
// app.inject(). As rotas inbound (callback dos providers) não entram aqui —
// não fazem sentido como tool, ninguém "chama" um webhook inbound a pedido.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../inject-helper'
import { callApi, toolResult } from '../inject-helper'
import { defineTool } from '../tool-helper'

const webhookEventEnum = z.enum([
  'BAN_DETECTED', 'NUMBER_ROTATED', 'NUMBER_DISCONNECTED',
  'MESSAGE_FAILED', 'MESSAGE_DELIVERED', 'MESSAGE_RECEIVED', 'PROVIDER_DOWN',
])

export function registerWebhooksTools(server: McpServer, ctx: McpToolContext) {
  defineTool(
    server,
    'apienvios_list_webhooks',
    'Lista os webhooks cadastrados na conta.',
    {},
    async () => toolResult(await callApi(ctx, { method: 'GET', url: '/v1/webhooks' })),
  )

  defineTool(
    server,
    'apienvios_create_webhook',
    'Cadastra um webhook. A URL é validada contra SSRF (rejeita IP privado/loopback/metadata da nuvem).',
    {
      url: z.string().url(),
      events: z.array(webhookEventEnum).min(1),
      secret: z.string().optional().describe('Segredo pra assinar/autenticar a entrega (?ws=)'),
    },
    async (input) => toolResult(await callApi(ctx, { method: 'POST', url: '/v1/webhooks', payload: input })),
  )

  defineTool(
    server,
    'apienvios_delete_webhook',
    'Remove um webhook da conta. Ação destrutiva — exige confirm:true (confirme com o usuário antes de chamar).',
    { id: z.string(), confirm: z.literal(true).describe('Precisa ser true — confirme com o usuário antes de chamar esta tool') },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'DELETE', url: `/v1/webhooks/${encodeURIComponent(id)}` })),
  )
}
