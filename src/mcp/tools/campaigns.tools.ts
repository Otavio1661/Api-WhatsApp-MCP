// src/mcp/tools/campaigns.tools.ts
// Espelha src/routes/campaigns.route.ts (authManage) via app.inject().
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../inject-helper'
import { callApi, toolResult } from '../inject-helper'
import { defineTool } from '../tool-helper'

export function registerCampaignsTools(server: McpServer, ctx: McpToolContext) {
  defineTool(
    server,
    'apienvios_create_campaign',
    'Dispara uma mensagem em lote pra até 1000 destinatários. Reusa a mesma fila e anti-flood do envio individual — cada destinatário pode ficar RATE_LIMITED se estourar o teto.',
    {
      to: z.array(z.string().min(10).max(20)).min(1).max(1000),
      type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']).default('TEXT'),
      text: z.string().optional(),
      mediaUrl: z.string().url().optional(),
      caption: z.string().optional(),
      instanceId: z.string().optional(),
      name: z.string().max(120).optional().describe('Rótulo do lote, aparece no monitor'),
      externalIdPrefix: z.string().max(80).optional().describe('Prefixo pra idempotência por destino'),
    },
    async (input) => toolResult(await callApi(ctx, { method: 'POST', url: '/v1/campaigns', payload: input })),
  )

  defineTool(
    server,
    'apienvios_list_campaigns',
    'Lista campanhas com progresso agregado (escopado ao MEMBER se aplicável).',
    { limit: z.number().int().min(1).max(50).default(20) },
    async ({ limit }) => toolResult(await callApi(ctx, { method: 'GET', url: `/v1/campaigns?limit=${limit}` })),
  )

  defineTool(
    server,
    'apienvios_get_campaign',
    'Progresso detalhado de uma campanha (contagem por status: enviado/falho/na fila).',
    { id: z.string() },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'GET', url: `/v1/campaigns/${encodeURIComponent(id)}` })),
  )
}
