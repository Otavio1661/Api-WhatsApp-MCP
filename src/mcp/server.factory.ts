// src/mcp/server.factory.ts
// Builds a new McpServer per request (stateless mode — see mcp.route.ts),
// registering the tools of every domain. The bridge `instructions` text is
// configurable (see bridge-instructions.ts).
// O ESCOPO real (qual conta, qual
// MEMBER) nunca é decidido aqui — vem de dentro de cada rota REST injetada,
// a partir do JWT (mesmo pipeline de auth de sempre).
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from './inject-helper'
import { registerMessagesTools } from './tools/messages.tools'
import { registerInstancesTools } from './tools/instances.tools'
import { registerCampaignsTools } from './tools/campaigns.tools'
import { registerWebhooksTools } from './tools/webhooks.tools'
import { registerMetricsTools } from './tools/metrics.tools'
import { registerAccountTools } from './tools/account.tools'
import { getBridgeInstructions } from './bridge-instructions'

export function createMcpServerForRequest(app: FastifyInstance, token: string, ip?: string): McpServer {
  const server = new McpServer({ name: 'apienvios', version: '1.0.0' }, { instructions: getBridgeInstructions() })
  const ctx: McpToolContext = { app, token, ip }

  registerMessagesTools(server, ctx)
  registerInstancesTools(server, ctx)
  registerCampaignsTools(server, ctx)
  registerWebhooksTools(server, ctx)
  registerMetricsTools(server, ctx)
  registerAccountTools(server, ctx)

  return server
}
