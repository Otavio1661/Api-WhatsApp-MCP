// src/mcp/inject-helper.ts
// Toda tool do MCP chama as rotas REST já existentes via app.inject() — não
// duplica NENHUMA lógica de negócio. Roda o pipeline inteiro de hooks
// (auth, memberScopeId, anti-flood, tudo), só que in-process, sem round-trip
// de rede real (mesmo mecanismo já usado em src/integration.test.ts).
import type { FastifyInstance } from 'fastify'

export interface McpToolContext {
  app: FastifyInstance
  token: string
  // IP do cliente que fez a chamada MCP original — propagado pro inject()
  // pra não empilhar todos os tenants no mesmo balde do rate-limit por IP
  // do processo (ver achado no plano: keyGenerator cai em request.ip quando
  // não há request.apiClient, que só é populado por API key/token de
  // instância, nunca por JWT).
  ip?: string
}

export interface ApiCallResult {
  statusCode: number
  body: unknown
}

export async function callApi(
  ctx: McpToolContext,
  opts: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: Record<string, unknown> },
): Promise<ApiCallResult> {
  const res = await ctx.app.inject({
    method: opts.method,
    url: opts.url,
    payload: opts.payload,
    remoteAddress: ctx.ip,
    headers: { authorization: `Bearer ${ctx.token}` },
  })
  let body: unknown
  try {
    body = res.body ? JSON.parse(res.body) : null
  } catch {
    body = res.body
  }
  return { statusCode: res.statusCode, body }
}

// Toda tool devolve o mesmo formato: statusCode + corpo, serializado como
// texto — o Claude enxerga tanto sucesso quanto erro (429 do anti-flood, 404
// de instância de outro MEMBER, etc.) sem precisar de tratamento especial.
export function toolResult(result: ApiCallResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}
