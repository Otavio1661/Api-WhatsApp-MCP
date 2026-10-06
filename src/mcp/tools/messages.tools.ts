// src/mcp/tools/messages.tools.ts
// Espelha src/routes/messages.route.ts (todas authManage) via app.inject() —
// ver src/mcp/inject-helper.ts. Nenhuma validação/anti-flood/escopo é
// reimplementada aqui, só a tradução pro formato de tool do MCP.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../inject-helper'
import { callApi, toolResult } from '../inject-helper'
import { defineTool } from '../tool-helper'

// Mesmos tipos de src/schemas/message.schema.ts — campos específicos de
// BUTTONS/LOCATION/CONTACT/POLL/LIST são validados de verdade do lado do
// servidor (a rota injetada); aqui só orienta o Claude a montar o payload.
const messageTypeEnum = z.enum([
  'TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'BUTTONS', 'LOCATION', 'CONTACT', 'POLL', 'LIST',
])

export function registerMessagesTools(server: McpServer, ctx: McpToolContext) {
  defineTool(
    server,
    'apienvios_send_message',
    'Envia uma mensagem de WhatsApp de verdade (ou agenda, se scheduledAt informado). Respeita o teto anti-flood por destinatário e a posse da instância — se estourar o limite, devolve 429; se a instância não pertencer ao usuário (MEMBER), devolve 404.',
    {
      to: z.string().min(10).max(20).describe('Telefone destino, com DDI (ex.: 5544999990000)'),
      type: messageTypeEnum.default('TEXT'),
      text: z.string().optional().describe('Texto (obrigatório se type=TEXT ou BUTTONS)'),
      mediaUrl: z.string().url().optional().describe('URL da mídia (obrigatório pra IMAGE/VIDEO/AUDIO/DOCUMENT/STICKER)'),
      caption: z.string().optional(),
      instanceId: z.string().optional().describe('ID ou slug da instância; se omitido, a conta escolhe automaticamente'),
      externalId: z.string().optional().describe('ID pra idempotência — reenviar com o mesmo externalId não duplica'),
      scheduledAt: z.string().datetime().optional().describe('ISO 8601 — se informado, agenda em vez de enviar imediatamente'),
      extra: z.record(z.any()).optional().describe('Campos extras exigidos por tipos especiais (buttons/location/contact/poll/list) — ver documentação da API'),
    },
    async (input) => {
      const { extra, ...rest } = input
      const result = await callApi(ctx, { method: 'POST', url: '/v1/messages', payload: { ...rest, ...extra } })
      return toolResult(result)
    },
  )

  defineTool(
    server,
    'apienvios_get_message',
    'Detalhe de uma mensagem (status, tentativas de envio) — escopado à conta/MEMBER autenticado.',
    { id: z.string() },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'GET', url: `/v1/messages/${encodeURIComponent(id)}` })),
  )

  defineTool(
    server,
    'apienvios_list_messages',
    'Lista mensagens da conta (ou só do MEMBER autenticado), com filtro opcional por status e paginação.',
    {
      status: z.enum(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SCHEDULED', 'CANCELLED']).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async ({ status, page, limit }) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (status) params.set('status', status)
      return toolResult(await callApi(ctx, { method: 'GET', url: `/v1/messages?${params}` }))
    },
  )

  defineTool(
    server,
    'apienvios_resend_message',
    'Reenfileira uma mensagem que falhou (status FAILED) ou que ficou travada em SENDING sem job na fila.',
    { id: z.string() },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'POST', url: `/v1/messages/${encodeURIComponent(id)}/resend` })),
  )

  defineTool(
    server,
    'apienvios_delete_message',
    'Remove uma mensagem do histórico (e tenta remover o job da fila, best-effort). Ação destrutiva — exige confirm:true (confirme com o usuário antes de chamar).',
    { id: z.string(), confirm: z.literal(true).describe('Precisa ser true — confirme com o usuário antes de chamar esta tool') },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'DELETE', url: `/v1/messages/${encodeURIComponent(id)}` })),
  )

  defineTool(
    server,
    'apienvios_list_inbound_messages',
    'Lista mensagens RECEBIDAS (cliente respondendo no WhatsApp) — polling, não é tempo real. Use pra checar se alguém te mandou algo desde a última checagem.',
    {
      instanceId: z.string().optional().describe('Filtra por uma instância específica'),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async ({ instanceId, page, limit }) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (instanceId) params.set('instanceId', instanceId)
      return toolResult(await callApi(ctx, { method: 'GET', url: `/v1/inbound-messages?${params}` }))
    },
  )

  defineTool(
    server,
    'apienvios_wait_inbound_messages',
    'Espera (long-poll, até ~20s) chegar mensagem RECEBIDA nova e devolve NA HORA que ela chega — resposta em ~1s, sem polling. Passe em `since` o `nextSince` da resposta anterior (na 1ª chamada omita). Se `timedOut` vier true e `data` vazio, nada chegou: chame de novo com o `nextSince` devolvido.',
    {
      since: z.string().optional().describe('Cursor ISO 8601: só mensagens criadas depois disso. Use o nextSince da chamada anterior; omita na primeira.'),
      instanceId: z.string().optional().describe('Filtra por uma instância específica'),
      timeoutSec: z.number().int().min(1).max(25).default(20).describe('Máximo de segundos que a chamada espera antes de devolver vazio'),
    },
    async ({ since, instanceId, timeoutSec }) => {
      const params = new URLSearchParams({ timeoutSec: String(timeoutSec) })
      if (since) params.set('since', since)
      if (instanceId) params.set('instanceId', instanceId)
      return toolResult(await callApi(ctx, { method: 'GET', url: `/v1/inbound-messages/wait?${params}` }))
    },
  )
  defineTool(
    server,
    'apienvios_get_inbound_media',
    'Baixa a mídia de uma mensagem RECEBIDA (use o `id` e o `mediaType` vindos de list/wait). Imagem e figurinha voltam como imagem pra você enxergar. Áudio do próprio dono já vem transcrito em `text`; para áudio sem `text` use apienvios_transcribe_inbound_audio.',
    {
      id: z.string().describe('id da mensagem recebida (campo `id` do list/wait)'),
    },
    async ({ id }) => {
      const result = await callApi(ctx, { method: 'GET', url: `/v1/inbound-messages/${encodeURIComponent(id)}/media` })
      const body = result.body as { mediaType?: string; mimetype?: string; base64?: string } | null
      if (result.statusCode === 200 && body?.base64 && (body.mediaType === 'image' || body.mediaType === 'sticker')) {
        return {
          content: [
            { type: 'image' as const, data: body.base64, mimeType: (body.mimetype ?? 'image/jpeg').split(';')[0] },
            { type: 'text' as const, text: `Mídia ${body.mediaType} da mensagem ${id}.` },
          ],
        }
      }
      if (result.statusCode === 200) {
        return toolResult({ statusCode: 200, body: { mediaType: body?.mediaType, mimetype: body?.mimetype, note: 'Só imagem e figurinha podem ser visualizadas por esta tool.' } })
      }
      return toolResult(result)
    },
  )
  defineTool(
    server,
    'apienvios_transcribe_inbound_audio',
    'Transcreve UM áudio recebido que veio sem `text` (áudio de outro número, não transcrito automaticamente). Use só para áudio de um chat que você está autorizado a responder. Devolve a transcrição.',
    {
      id: z.string().describe('id da mensagem de áudio recebida (campo `id` do list/wait)'),
    },
    async ({ id }) => toolResult(await callApi(ctx, { method: 'POST', url: `/v1/inbound-messages/${encodeURIComponent(id)}/transcribe` })),
  )
}
