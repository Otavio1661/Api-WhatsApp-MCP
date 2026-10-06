// src/services/mcp-oauth.service.ts
// Estado Redis do fluxo OAuth 2.1 (Authorization Code + PKCE) do MCP remoto do
// ApiEnvios. Três "coisas" guardadas, cada uma com seu próprio namespace e TTL:
//   1) client registrado via Dynamic Client Registration (RFC 7591) — client
//      público (sem client_secret), como Claude Desktop/Code.
//   2) autorização pendente — parâmetros do /authorize em trânsito até o POST
//      de login (evita expor code_challenge/redirect_uri crus em campo hidden
//      do form, que dava pra adulterar via DevTools).
//   3) código de autorização — de vida curta, single-use, o que efetivamente
//      prova que o login aconteceu; trocado pelo token real em /token.
//
// Redis-only de propósito (decisão registrada no plano): clients MCP são
// efêmeros por natureza — se o Redis for flushado, o Claude simplesmente
// re-registra sozinho no próximo handshake, sem fricção visível pro usuário.
import { randomBytes, createHash } from 'node:crypto'
import { redis } from '../utils/redis'

const PREFIX = 'mcp:oauth'
const CLIENT_TTL_SECONDS = 180 * 24 * 60 * 60 // 180 dias
// 30 min (era 5) — 5min estourava com frequência em produção: o assistente
// de conexão do claude.ai (Settings > Conectores > Adicionar) tem 3 passos
// de verificação ANTES de mostrar o form de login, e o usuário ainda precisa
// digitar email/senha — o total facilmente passava de 5min, sempre com o
// mesmo erro "Sessão de autorização expirada" mesmo em tentativas de boa-fé
//. É só um Redis TTL de um estado OAuth opaco
// (sem segredo real dentro), então alongar não é um risco de segurança
// meaningful — o código de autorização final (CODE_TTL_SECONDS) continua
// curto (90s).
const PENDING_TTL_SECONDS = 30 * 60
const CODE_TTL_SECONDS = 90 // vida curta, single-use

export interface RegisteredClient {
  client_id: string
  client_name: string
  redirect_uris: string[]
  token_endpoint_auth_method: 'none'
  client_id_issued_at: number
}

export interface PendingAuthorization {
  client_id: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: 'S256'
  state?: string
  resource?: string
}

export interface AuthorizationCodeData {
  userId: string
  apiClientId: string
  accountRole: string
  client_id: string
  redirect_uri: string
  code_challenge: string
  resource?: string
}

function clientKey(clientId: string): string {
  return `${PREFIX}:client:${clientId}`
}
function pendingKey(opaque: string): string {
  return `${PREFIX}:pending:${opaque}`
}
function codeKey(code: string): string {
  return `${PREFIX}:code:${code}`
}

// ── Dynamic Client Registration (RFC 7591, simplificado) ──────
export async function registerClient(input: {
  client_name?: string
  redirect_uris: string[]
}): Promise<RegisteredClient> {
  const client: RegisteredClient = {
    client_id: randomBytes(16).toString('hex'),
    client_name: input.client_name ?? 'Cliente MCP',
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: 'none',
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }
  await redis.set(clientKey(client.client_id), JSON.stringify(client), 'EX', CLIENT_TTL_SECONDS)
  return client
}

export async function getClient(clientId: string): Promise<RegisteredClient | null> {
  const raw = await redis.get(clientKey(clientId))
  return raw ? JSON.parse(raw) : null
}

// ── Autorização pendente (entre o GET e o POST de /authorize) ─
export async function createPendingAuthorization(data: PendingAuthorization): Promise<string> {
  const opaque = randomBytes(24).toString('base64url')
  await redis.set(pendingKey(opaque), JSON.stringify(data), 'EX', PENDING_TTL_SECONDS)
  return opaque
}

// Leitura pura (sem apagar) — usada tanto pra renderizar o form (GET) quanto
// pra reexibi-lo com erro em caso de credencial inválida (POST que falhou).
export async function getPendingAuthorization(opaque: string): Promise<PendingAuthorization | null> {
  const raw = await redis.get(pendingKey(opaque))
  return raw ? JSON.parse(raw) : null
}

export async function deletePendingAuthorization(opaque: string): Promise<void> {
  await redis.del(pendingKey(opaque))
}

// ── Código de autorização (trocado pelo token em /token) ──────
export async function createAuthorizationCode(data: AuthorizationCodeData): Promise<string> {
  const code = randomBytes(32).toString('base64url')
  await redis.set(codeKey(code), JSON.stringify(data), 'EX', CODE_TTL_SECONDS)
  return code
}

// Single-use: apaga assim que lido, mesmo se o PKCE não bater depois (o code
// já foi "gasto" — replay do mesmo code nunca funciona duas vezes).
export async function consumeAuthorizationCode(code: string): Promise<AuthorizationCodeData | null> {
  const raw = await redis.get(codeKey(code))
  if (!raw) return null
  await redis.del(codeKey(code))
  return JSON.parse(raw)
}

// PKCE S256 — nunca aceitar code_challenge_method=plain.
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash('sha256').update(codeVerifier).digest('base64url')
  return computed === codeChallenge
}
