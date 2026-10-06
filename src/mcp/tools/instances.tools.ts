// src/mcp/tools/instances.tools.ts
// Espelha as operações centrais de src/routes/instances.route.ts (authManage)
// via app.inject(). Fora do escopo da v1 (ver plano): sub-ações raras por
// instância (presence/react/read/check-number) e rotas por Token de instância
// (authInstance) — são mecanismo de máquina-a-máquina, não fazem sentido
// como tool de um humano autenticado via OAuth.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../inject-helper'
import { callApi, toolResult } from '../inject-helper'
import { defineTool } from '../tool-helper'

export function registerInstancesTools(server: McpServer, ctx: McpToolContext) {
  defineTool(
    server,
    'apienvios_list_instances',
    'Lista as instâncias (números de WhatsApp) da conta — se MEMBER, só as próprias.',
    { page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) },
    async ({ page, limit }) =>
      toolResult(await callApi(ctx, { method: 'GET', url: `/v1/instances?page=${page}&limit=${limit}` })),
  )

  defineTool(
    server,
    'apienvios_get_instance',
    'Detalhe de uma instância (id ou slug).',
    { id: z.string() },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'GET', url: `/v1/instances/${encodeURIComponent(id)}` })),
  )

  defineTool(
    server,
    'apienvios_instances_stats',
    'Estatísticas agregadas das instâncias da conta (contagem por status/provider).',
    {},
    async () => toolResult(await callApi(ctx, { method: 'GET', url: '/v1/instances/stats' })),
  )

  defineTool(
    server,
    'apienvios_create_instance',
    'Cria uma nova instância (número de WhatsApp) — respeita a cota maxInstances da conta.',
    {
      provider: z.enum(['EVOLUTION', 'WUZAPI', 'CLOUD_API']),
      name: z.string().optional(),
      slug: z.string().optional(),
      priority: z.number().int().min(0).default(0),
    },
    async (input) => toolResult(await callApi(ctx, { method: 'POST', url: '/v1/instances', payload: input })),
  )

  defineTool(
    server,
    'apienvios_update_instance',
    'Renomeia uma instância (name e/ou slug — ao menos um obrigatório).',
    { id: z.string(), name: z.string().min(1).optional(), slug: z.string().optional() },
    async ({ id, ...body }) =>
      toolResult(await callApi(ctx, { method: 'PATCH', url: `/v1/instances/${encodeURIComponent(id)}`, payload: body })),
  )

  defineTool(
    server,
    'apienvios_delete_instance',
    'Apaga uma instância (cascata: números, mensagens associadas). Ação destrutiva — exige confirm:true (confirme com o usuário antes de chamar).',
    { id: z.string(), confirm: z.literal(true).describe('Precisa ser true — confirme com o usuário antes de chamar esta tool') },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'DELETE', url: `/v1/instances/${encodeURIComponent(id)}` })),
  )

  defineTool(
    server,
    'apienvios_connect_instance',
    'Inicia a conexão de uma instância (gera QR code pra escanear, dependendo do provider).',
    { id: z.string() },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'POST', url: `/v1/instances/${encodeURIComponent(id)}/connect` })),
  )

  defineTool(
    server,
    'apienvios_get_instance_qr',
    'QR code atual da instância (string, geralmente data-URL) pra parear o WhatsApp.',
    { id: z.string() },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'GET', url: `/v1/instances/${encodeURIComponent(id)}/qr` })),
  )

  defineTool(
    server,
    'apienvios_get_instance_status',
    'Status de conexão atual da instância (sincroniza com o provider antes de responder).',
    { id: z.string() },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'GET', url: `/v1/instances/${encodeURIComponent(id)}/status` })),
  )

  defineTool(
    server,
    'apienvios_rotate_instance',
    'Força a rotação/reconexão de uma instância (novo QR, desconecta a sessão atual do provider).',
    { id: z.string() },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'POST', url: `/v1/instances/${encodeURIComponent(id)}/rotate` })),
  )
}
