// src/mcp/tools/account.tools.ts
// Espelha src/routes/account.route.ts (authJwt+requireOwner — self-service do
// OWNER pra gerenciar MEMBERs da própria conta) via app.inject(). Se quem
// logou no MCP não for OWNER/SUPER_ADMIN, a rota injetada devolve 403 —
// mesmo comportamento de sempre, nada de tratamento especial aqui.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../inject-helper'
import { callApi, toolResult } from '../inject-helper'
import { defineTool } from '../tool-helper'

export function registerAccountTools(server: McpServer, ctx: McpToolContext) {
  defineTool(
    server,
    'apienvios_list_members',
    'Lista os MEMBERs (usuários) da conta — exige ser OWNER ou SUPER_ADMIN.',
    {},
    async () => toolResult(await callApi(ctx, { method: 'GET', url: '/v1/account/users' })),
  )

  defineTool(
    server,
    'apienvios_create_member',
    'Cria um MEMBER na própria conta (login local com e-mail e senha).',
    { email: z.string().email(), password: z.string().min(8), name: z.string().optional() },
    async (input) => toolResult(await callApi(ctx, { method: 'POST', url: '/v1/account/users', payload: input })),
  )

  defineTool(
    server,
    'apienvios_update_member',
    'Atualiza nome e/ou senha de um MEMBER da própria conta.',
    { id: z.string(), name: z.string().min(1).optional(), password: z.string().min(8).optional() },
    async ({ id, ...body }) =>
      toolResult(await callApi(ctx, { method: 'PATCH', url: `/v1/account/users/${encodeURIComponent(id)}`, payload: body })),
  )

  defineTool(
    server,
    'apienvios_delete_member',
    'Remove um MEMBER da própria conta. Ação destrutiva — exige confirm:true (confirme com o usuário antes de chamar).',
    { id: z.string(), confirm: z.literal(true).describe('Precisa ser true — confirme com o usuário antes de chamar esta tool') },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'DELETE', url: `/v1/account/users/${encodeURIComponent(id)}` })),
  )
}
