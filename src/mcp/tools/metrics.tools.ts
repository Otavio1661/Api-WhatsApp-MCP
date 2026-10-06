// src/mcp/tools/metrics.tools.ts
// Espelha src/routes/metrics.route.ts (authManage) via app.inject().
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../inject-helper'
import { callApi, toolResult } from '../inject-helper'
import { defineTool } from '../tool-helper'

export function registerMetricsTools(server: McpServer, ctx: McpToolContext) {
  defineTool(
    server,
    'apienvios_metrics',
    'Métricas de envio da conta: totais, série diária, por instância/número.',
    { days: z.number().int().min(1).max(90).default(7) },
    async ({ days }) => toolResult(await callApi(ctx, { method: 'GET', url: `/v1/metrics?days=${days}` })),
  )
}
