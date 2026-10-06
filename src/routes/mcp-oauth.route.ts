// src/routes/mcp-oauth.route.ts
// Authorization Server OAuth 2.1 (Authorization Code + PKCE, client público
// via Dynamic Client Registration) do MCP remoto do ApiEnvios. Implementado
// como rotas Fastify nativas (não o router Express do @modelcontextprotocol/
// sdk — ver decisão no plano) — só reaproveita os CONCEITOS do spec.
//
// O "access token" emitido aqui É o MESMO JWT que /v1/auth/login e o painel
// já usam (app.jwt.sign + marcarAtiva no Redis) — zero mecanismo de sessão
// novo. Ver src/services/mcp-oauth.service.ts pro estado Redis (clients,
// autorização pendente, código) e src/services/credential-validation.service.ts
// pra validação de e-mail+senha (mesma dos outros 2 logins do sistema).
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { validarCredenciais } from '../services/credential-validation.service'
import {
  getOrSetDeviceId,
  verificarBloqueio,
  registrarTentativaFalha,
  limparAposSucesso,
} from '../services/login-rate-limit.service'
import { marcarAtiva } from '../services/session-activity.service'
import { config } from '../config'
import {
  registerClient,
  getClient,
  createPendingAuthorization,
  getPendingAuthorization,
  deletePendingAuthorization,
  createAuthorizationCode,
  consumeAuthorizationCode,
  verifyPkce,
} from '../services/mcp-oauth.service'

const ASSET_VERSION = Date.now().toString(36)

// redirect_uri restrito a https:// (ou http://localhost/127.0.0.1, permitido
// pela RFC 8252 pra clients nativos rodando loopback) — sem isso, DCR aceita
// qualquer esquema (javascript:/data:/file:) e um client malicioso registrado
// via /register conseguiria abrir `reply.redirect()` pra um destino perigoso
//.
const redirectUriSchema = z.string().url().refine(
  (uri) => {
    try {
      const u = new URL(uri)
      if (u.protocol === 'https:') return true
      return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
    } catch {
      return false
    }
  },
  { message: 'redirect_uri deve ser https:// (ou http://localhost para desenvolvimento local)' },
)

async function renderLoginPage(app: FastifyInstance, reply: any, data: Record<string, unknown>) {
  const body = await app.view('login', { title: 'Autorizar — ApiEnvios', ...data })
  const html = await app.view('layout', { body, assetVersion: ASSET_VERSION })
  return reply.type('text/html').send(html)
}

const registerSchema = z.object({
  client_name: z.string().min(1).max(200).optional(),
  redirect_uris: z.array(redirectUriSchema).min(1),
})

const authorizeQuerySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: redirectUriSchema,
  code_challenge: z.string().min(43).max(128), // tamanho de um SHA-256 base64url
  code_challenge_method: z.literal('S256'), // nunca aceitar "plain"
  state: z.string().optional(),
  resource: z.string().optional(),
})

const authorizeFormSchema = z.object({
  mcp_pending: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
})

const tokenSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  client_id: z.string().min(1),
  redirect_uri: redirectUriSchema,
})

// Chromium/Edge aplicam `form-action` também ao REDIRECT que a resposta do POST
// devolve: com 'self' só, o 302 do login pro redirect_uri do client (localhost do
// Claude Code, claude.ai) é bloqueado e a página fica parada no formulário —
// o code nunca chega ao client. Libera só a origem do redirect_uri, que já foi
// validado contra o client registrado antes de qualquer render.
function allowRedirectInFormAction(reply: FastifyReply, redirectUri: string) {
  const csp = reply.getHeader('content-security-policy')
  if (typeof csp !== 'string') return
  const origin = new URL(redirectUri).origin
  reply.header('content-security-policy', csp.replace("form-action 'self'", `form-action 'self' ${origin}`))
}

export async function mcpOAuthRoutes(app: FastifyInstance) {
  // ── POST /register — Dynamic Client Registration (RFC 7591) ──
  app.post('/register', async (request, reply) => {
    const body = registerSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid_client_metadata', error_description: 'redirect_uris obrigatório' })
    }
    const client = await registerClient(body.data)
    return reply.status(201).send(client)
  })

  // ── GET /authorize — Mostra o login (reaproveita login.eta) ───
  app.get<{ Querystring: Record<string, string> }>('/authorize', async (request, reply) => {
    const query = authorizeQuerySchema.safeParse(request.query)
    if (!query.success) {
      // Não redireciona em erro de parâmetro — não dá pra confiar no
      // redirect_uri antes de validar o formato/client (open redirect).
      return reply.status(400).send({ error: 'invalid_request', error_description: 'Parâmetros OAuth inválidos ou ausentes.' })
    }

    const client = await getClient(query.data.client_id)
    if (!client || !client.redirect_uris.includes(query.data.redirect_uri)) {
      return reply.status(400).send({ error: 'invalid_client', error_description: 'Client não registrado ou redirect_uri não corresponde.' })
    }

    const opaque = await createPendingAuthorization({
      client_id: query.data.client_id,
      redirect_uri: query.data.redirect_uri,
      code_challenge: query.data.code_challenge,
      code_challenge_method: query.data.code_challenge_method,
      state: query.data.state,
      resource: query.data.resource,
    })

    allowRedirectInFormAction(reply, query.data.redirect_uri)
    return renderLoginPage(app, reply, {
      formAction: '/mcp/oauth/authorize',
      mcpPending: opaque,
      mcpClientName: client.client_name,
      mcpRedirectHost: new URL(query.data.redirect_uri).host,
    })
  })

  // ── POST /authorize — Login + emissão do authorization code ──
  app.post('/authorize', async (request, reply) => {
    const body = authorizeFormSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid_request' })
    }

    const pending = await getPendingAuthorization(body.data.mcp_pending)
    if (!pending) {
      // Formulário expirou (5min) ou já foi usado — sem redirect_uri
      // confiável em mãos aqui, melhor pedir pra recomeçar do zero no Claude.
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'Sessão de autorização expirada. Tente conectar novamente pelo Claude.',
      })
    }

    const dispositivoId = getOrSetDeviceId(request, reply)
    const bloqueio = await verificarBloqueio(request.ip, body.data.email, dispositivoId)
    if (bloqueio.bloqueado) {
      reply.status(429)
      allowRedirectInFormAction(reply, pending.redirect_uri)
      return renderLoginPage(app, reply, {
        formAction: '/mcp/oauth/authorize',
        mcpPending: body.data.mcp_pending,
        mcpClientName: (await getClient(pending.client_id))?.client_name,
        mcpRedirectHost: new URL(pending.redirect_uri).host,
        error: `Muitas tentativas. Tente novamente em ${Math.ceil(bloqueio.segundosRestantes / 60)} min.`,
        email: body.data.email,
      })
    }

    const { ok, user } = await validarCredenciais(body.data.email, body.data.password)
    if (!ok || !user) {
      await registrarTentativaFalha(request.ip, body.data.email, dispositivoId)
      reply.status(401)
      allowRedirectInFormAction(reply, pending.redirect_uri)
      return renderLoginPage(app, reply, {
        formAction: '/mcp/oauth/authorize',
        mcpPending: body.data.mcp_pending,
        mcpClientName: (await getClient(pending.client_id))?.client_name,
        mcpRedirectHost: new URL(pending.redirect_uri).host,
        error: 'Credenciais inválidas.',
        email: body.data.email,
      })
    }

    await limparAposSucesso(request.ip, body.data.email)

    const code = await createAuthorizationCode({
      userId: user.id,
      apiClientId: user.apiClientId,
      accountRole: user.apiClient.role,
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge,
      resource: pending.resource,
    })
    await deletePendingAuthorization(body.data.mcp_pending)

    const redirectUrl = new URL(pending.redirect_uri)
    redirectUrl.searchParams.set('code', code)
    if (pending.state) redirectUrl.searchParams.set('state', pending.state)
    return reply.redirect(redirectUrl.toString())
  })

  // ── POST /token — Troca code+verifier pelo JWT real ───────────
  app.post('/token', async (request, reply) => {
    const body = tokenSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid_request' })
    }

    const data = await consumeAuthorizationCode(body.data.code)
    if (
      !data ||
      data.client_id !== body.data.client_id ||
      data.redirect_uri !== body.data.redirect_uri ||
      !verifyPkce(body.data.code_verifier, data.code_challenge)
    ) {
      // Mesma mensagem genérica pra qualquer motivo de rejeição (code
      // inexistente/expirado/já usado, client/redirect_uri não batem, PKCE
      // não bate) — não vaza qual validação especificamente falhou.
      return reply.status(400).send({ error: 'invalid_grant' })
    }

    const jti = randomUUID()
    const token = app.jwt.sign({
      userId: data.userId,
      apiClientId: data.apiClientId,
      accountRole: data.accountRole,
      jti,
    })
    await marcarAtiva(jti)

    // expires_in é o que o client usa pra descartar o token; o timeout de
    // inatividade (deslizante) é do servidor. Anunciar os 30min de inatividade
    // aqui derrubava a sessão do client mesmo com uso contínuo (sem
    // refresh_token, ele exigia novo login).
    const claims = app.jwt.decode<{ exp: number; iat: number }>(token)
    const expiresIn = claims ? claims.exp - claims.iat : config.app.sessionIdleTimeoutMin * 60

    return reply.send({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: 'mcp',
    })
  })
}
