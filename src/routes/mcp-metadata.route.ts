// src/routes/mcp-metadata.route.ts
// Metadata de descoberta OAuth (RFC 8414 + RFC 9728) do MCP remoto — os
// clients (Claude Desktop/Code) buscam isso na RAIZ do domínio antes de
// qualquer outra coisa, pra descobrir authorization_endpoint/token_endpoint/
// registration_endpoint sozinhos. Por isso este arquivo é registrado SEM
// prefixo em server.ts, diferente de mcp-oauth.route.ts (prefixo /mcp/oauth).
import type { FastifyInstance } from 'fastify'
import { config } from '../config'

export async function mcpMetadataRoutes(app: FastifyInstance) {
  const issuer = config.app.apiPublicUrl.replace(/\/$/, '')

  app.get('/.well-known/oauth-authorization-server', async (_request, reply) => {
    return reply.send({
      issuer,
      authorization_endpoint: `${issuer}/mcp/oauth/authorize`,
      token_endpoint: `${issuer}/mcp/oauth/token`,
      registration_endpoint: `${issuer}/mcp/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    })
  })

  const protectedResourceHandler = async (_request: unknown, reply: any) => {
    return reply.send({
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
    })
  }

  // RFC 9728: quando o recurso protegido não fica na raiz do domínio (o
  // nosso é /mcp, não /), clients descobrem a metadata tanto no caminho
  // "bare" quanto no caminho com o path do recurso ANEXADO
  // (/.well-known/oauth-protected-resource/mcp) — sem essa 2ª rota, o
  // fluxo de reautenticação automática do client (depois de um 401 em
  // /mcp) batia num 404 aqui e nunca conseguia se recuperar sozinho,
  // sempre pedindo login manual de novo (achado ao vivo em 2026-09-27).
  app.get('/.well-known/oauth-protected-resource', protectedResourceHandler)
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandler)
}
