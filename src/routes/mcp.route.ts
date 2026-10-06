// src/routes/mcp.route.ts
// Endpoint de transporte MCP (Streamable HTTP, modo stateless — um McpServer
// novo por request, sem estado de sessão MCP entre chamadas). O "access
// token" é um JWT normal do ApiEnvios (emitido em mcp-oauth.route.ts), então
// authJwt já valida tudo (assinatura, sessão viva no Redis) sem nenhum código
// de auth novo aqui.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { authJwt } from '../middlewares/auth.middleware'
import { createMcpServerForRequest } from '../mcp/server.factory'
import { config } from '../config'

// RFC 9728 §5.1: um 401 no recurso protegido deveria vir com um header
// WWW-Authenticate apontando pra URL da metadata — sem isso, o client tem
// que ADIVINHAR essa URL por convenção (viu-se ao vivo, 2026-09-27, um client
// tentando `/.well-known/oauth-protected-resource/mcp` sozinho; sem essa
// rota registrada — corrigido em mcp-metadata.route.ts — ele nunca
// completava a reautenticação automática, sempre pedindo login manual de
// novo). Setar o header explicitamente é a forma robusta/spec-correta,
// independente de qualquer convenção de URL que o client possa ou não tentar.
async function withWwwAuthenticate(_request: FastifyRequest, reply: FastifyReply) {
  const issuer = config.app.apiPublicUrl.replace(/\/$/, '')
  reply.header('WWW-Authenticate', `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`)
}

export async function mcpRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: [withWwwAuthenticate, authJwt] }, async (request: FastifyRequest, reply: FastifyReply) => {
    // authJwt garante que este header existe e é um Bearer válido — repassado
    // tal qual pros tools usarem no app.inject() (mesma identidade, mesma
    // sessão, sem reemitir nada).
    const token = request.headers.authorization!.replace(/^Bearer\s+/i, '')

    const mcpServer = createMcpServerForRequest(app, token, request.ip)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

    // reply.hijack(): a partir daqui o Fastify não tenta mais finalizar a
    // resposta sozinho — o transport escreve direto em reply.raw (Node puro).
    reply.hijack()
    await mcpServer.connect(transport)
    // O Fastify já consumiu e parseou o body (JSON) antes deste handler
    // rodar, então request.raw não tem mais o stream — por isso o body já
    // parseado (request.body) é passado como 3º argumento.
    await transport.handleRequest(request.raw, reply.raw, request.body)
  })
}
