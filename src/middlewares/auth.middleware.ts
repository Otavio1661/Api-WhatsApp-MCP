// src/middlewares/auth.middleware.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../utils/prisma'
import { config } from '../config'
import { estaAtiva, renovar } from '../services/session-activity.service'
import type { JwtUserPayload } from '../types'
import {
  tryHashForLookup,
  decryptApiClientSecret,
  decryptInstanceSecrets,
} from '../utils/secrets-crypto'

// apiKey/token são cifrados em repouso (ver secrets-crypto.ts), então
// a busca no banco não pode mais ser `WHERE apiKey = <valor recebido>` direto —
// o valor recebido é texto puro, a coluna guarda ciphertext não-determinístico.
// Busca por `apiKeyHash`/`tokenHash` (índice cego, HMAC determinístico) OU pelo
// valor em texto puro — o segundo é o fallback pra dado legado que ainda não
// passou pelo script de migração de dados (produção, hoje). Por isso os
// findUnique() viraram findFirst() (o OR de duas colunas @unique não é uma
// forma válida de where de findUnique). Remover o fallback só depois que TODOS
// os registros reais tiverem hash preenchido.
//
// tryHashForLookup() (em vez de hashForLookup()) porque SECRETS_ENCRYPTION_KEY
// pode ainda não estar configurada (deploy antes de a env var subir, ou
// ambiente de teste) — nesse caso cai pro filtro só pelo valor em texto puro,
// EXATAMENTE o comportamento de antes desta feature. Nunca quebra auth
// existente por falta de chave.
function byHashOrPlain(hashField: string, plain: string, plainField: string) {
  const hash = tryHashForLookup(plain)
  return hash ? { OR: [{ [hashField]: hash }, { [plainField]: plain }] } : { [plainField]: plain }
}

// decryptApiClientSecret/decryptInstanceSecrets lançam se o valor já estiver
// cifrado mas a chave estiver ausente/errada (ex.: SECRETS_ENCRYPTION_KEY
// rotacionada ou removida por engano depois que já existem registros
// cifrados). Nos caminhos de auth "duros" (authAccount/authInstance/authJwt)
// isso NÃO pode virar 500 pro cliente — vira o mesmo 401 de credencial
// inválida, que é o comportamento seguro (nem pior nem melhor que negar
// acesso por engano; o que não pode é vazar stack trace/500 num endpoint de
// auth). `resolveTenantContext` já tem seu próprio try/catch best-effort.
function safeDecrypt<T>(decrypt: () => T): T | null {
  try {
    return decrypt()
  } catch {
    return null
  }
}

// ── Auth por API key de conta (gestão) ────────────────────────
// Resolve o ApiClient pela apiKey (header x-api-key ou Bearer) e o anexa
// em request.apiClient para escopar todas as queries por tenant.
export async function authAccount(request: FastifyRequest, reply: FastifyReply) {
  // Reaproveita o ApiClient já resolvido por resolveTenantContext (onRequest) quando
  // veio pelo mesmo mecanismo (API key), evitando reconsultar o Postgres na mesma
  // request. Exclui o caso em que a resolução veio por token de
  // instância (request.instance setado) — token de instância não é API key de conta.
  if (request.apiClient && !request.instance) {
    return
  }

  const apiKey =
    (request.headers['x-api-key'] as string) ??
    request.headers.authorization?.replace('Bearer ', '')

  if (!apiKey) {
    return reply.status(401).send({ error: 'API key obrigatória' })
  }

  // Em desenvolvimento, aceita o secret do .env diretamente.
  // Resolve um ApiClient admin do seed para que as queries escopadas funcionem.
  if (config.app.isDev && apiKey === config.app.apiSecret) {
    const admin = await prisma.apiClient.findFirst({
      where: { role: 'ADMIN', active: true },
    })
    const decryptedAdmin = admin && safeDecrypt(() => decryptApiClientSecret(admin))
    if (decryptedAdmin) {
      request.apiClient = decryptedAdmin
      return
    }
    return reply.status(401).send({ error: 'Nenhum ApiClient admin disponível (rode o seed)' })
  }

  const client = await prisma.apiClient.findFirst({
    where: { active: true, ...byHashOrPlain('apiKeyHash', apiKey, 'apiKey') },
  })

  const decryptedClient = client && safeDecrypt(() => decryptApiClientSecret(client))
  if (!decryptedClient) {
    return reply.status(401).send({ error: 'API key inválida ou inativa' })
  }

  // Injeta client na request para uso nas rotas
  request.apiClient = decryptedClient
}

// ── Auth por token de instância (envio) ───────────────────────
// Lê o header `Token`, resolve a Instance por token (com apiClient incluído)
// e anexa request.instance + request.apiClient. Opcionalmente valida contra
// o :id da rota.
export async function authInstance(
  request: FastifyRequest<{ Params?: { id?: string } }>,
  reply: FastifyReply,
) {
  // Reaproveita instance/apiClient já resolvidos por resolveTenantContext (onRequest)
  // quando vieram pelo mesmo mecanismo (token de instância), evitando reconsultar o
  // Postgres na mesma request. Exige os dois setados: resolveTenantContext
  // só popula request.instance junto com request.apiClient quando resolve por token.
  if (!request.instance || !request.apiClient) {
    const token =
      (request.headers['token'] as string) ??
      (request.headers['x-token'] as string)

    if (!token) {
      return reply.status(401).send({ error: 'Token de instância obrigatório' })
    }

    const instance = await prisma.instance.findFirst({
      where: byHashOrPlain('tokenHash', token, 'token'),
      include: { apiClient: true },
    })

    if (!instance || !instance.apiClient.active) {
      return reply.status(401).send({ error: 'Token de instância inválido' })
    }

    const { apiClient, ...instanceData } = instance
    const decrypted = safeDecrypt(() => ({
      instance: decryptInstanceSecrets(instanceData),
      apiClient: decryptApiClientSecret(apiClient),
    }))
    if (!decrypted) {
      return reply.status(401).send({ error: 'Token de instância inválido' })
    }
    request.instance = decrypted.instance
    request.apiClient = decrypted.apiClient
  }

  // Se a rota tiver :id, valida que bate com a instância do token (sempre, mesmo
  // quando reaproveitado de resolveTenantContext).
  const routeId = (request.params as { id?: string } | undefined)?.id
  if (routeId && routeId !== request.instance.id) {
    return reply.status(401).send({ error: 'Token não corresponde à instância informada' })
  }
}

// ── Resolução leve de tenant para rate limit (onRequest) ──────
// NÃO rejeita: apenas tenta resolver o ApiClient (por API key OU token de instância)
// e o anexa em request.apiClient, para que o @fastify/rate-limit aplique o limite
// por tenant. A autenticação efetiva (e os 401/403) continua nos preHandlers
// authAccount/authInstance/requireAdmin. Rotas públicas são ignoradas.
export async function resolveTenantContext(request: FastifyRequest) {
  if (request.apiClient) return
  // Ignora rotas públicas (health e callbacks inbound dos providers) e o painel web
  // (autenticado por cookie httpOnly, resolvido no preHandler requirePanelAuth).
  if (
    request.url === '/health' ||
    request.url.includes('/webhooks/inbound/') ||
    request.url.startsWith('/admin')
  )
    return

  try {
    const apiKey =
      (request.headers['x-api-key'] as string) ??
      request.headers.authorization?.replace('Bearer ', '')

    if (apiKey) {
      if (config.app.isDev && apiKey === config.app.apiSecret) {
        const admin = await prisma.apiClient.findFirst({ where: { role: 'ADMIN', active: true } })
        if (admin) request.apiClient = decryptApiClientSecret(admin)
        return
      }
      const client = await prisma.apiClient.findFirst({
        where: { active: true, ...byHashOrPlain('apiKeyHash', apiKey, 'apiKey') },
      })
      if (client) request.apiClient = decryptApiClientSecret(client)
      return
    }

    const token = (request.headers['token'] as string) ?? (request.headers['x-token'] as string)
    if (token) {
      const instance = await prisma.instance.findFirst({
        where: byHashOrPlain('tokenHash', token, 'token'),
        include: { apiClient: true },
      })
      if (instance?.apiClient?.active) {
        const { apiClient, ...instanceData } = instance
        request.apiClient = decryptApiClientSecret(apiClient)
        request.instance = decryptInstanceSecrets(instanceData)
      }
    }
  } catch {
    // Resolução é best-effort; falha aqui não bloqueia o request.
  }
}

// ── Auth por JWT (login humano) ───────────────────────────────
// Valida o JWT (header Authorization: Bearer), carrega o ApiClient da conta
// e o User do payload, e anexa request.apiClient (REUSA o escopo por tenant)
// + request.authUser. 401 se inválido/expirado ou conta inativa.
export async function authJwt(request: FastifyRequest, reply: FastifyReply) {
  let payload: JwtUserPayload
  try {
    payload = await request.jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'Token inválido ou expirado' })
  }

  // Sessão precisa estar viva no Redis — cobre logout (POST /auth/logout) e
  // inatividade (TTL deslizante), nenhum dos dois que o JWT sozinho resolve.
  if (!process.env.VITEST) {
    const viva = await estaAtiva(payload.jti)
    if (!viva) return reply.status(401).send({ error: 'Sessão expirada. Faça login novamente.' })
    await renovar(payload.jti)
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { apiClient: true },
  })

  if (!user || !user.apiClient.active) {
    return reply.status(401).send({ error: 'Usuário ou conta inválidos/inativos' })
  }

  const { apiClient, passwordHash, ...userData } = user
  const decryptedApiClient = safeDecrypt(() => decryptApiClientSecret(apiClient))
  if (!decryptedApiClient) {
    return reply.status(401).send({ error: 'Usuário ou conta inválidos/inativos' })
  }
  request.apiClient = decryptedApiClient
  request.authUser = {
    id: userData.id,
    email: userData.email,
    name: userData.name,
    role: userData.role,
  }
}

// ── Auth combinado: API key OU JWT (endpoints de gestão) ──────
// Mantém 100% de compatibilidade com a API key de conta. Estratégia:
// 1) Se houver header `x-api-key`, usa authAccount (API key explícita).
// 2) Caso contrário, se houver `Authorization: Bearer <valor>`, decide pelo
//    formato do valor: um JWT tem 3 segmentos separados por ponto → authJwt;
//    qualquer outro valor é tratado como API key de conta → authAccount.
// 3) Sem nenhum dos dois → 401 (delegado ao authAccount, que já responde 401).
export async function authManage(request: FastifyRequest, reply: FastifyReply) {
  const apiKeyHeader = request.headers['x-api-key'] as string | undefined
  if (apiKeyHeader) {
    return authAccount(request, reply)
  }

  const bearer = request.headers.authorization?.replace('Bearer ', '')
  // Heurística: 3 partes separadas por ponto ⇒ JWT (header.payload.signature).
  if (bearer && bearer.split('.').length === 3) {
    return authJwt(request, reply)
  }

  // Sem JWT detectável: trata como API key de conta (mantém compatibilidade).
  return authAccount(request, reply)
}

// ── Exige papel ADMIN (usar depois de authAccount) ────────────
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.apiClient?.role !== 'ADMIN') {
    return reply.status(403).send({ error: 'Acesso restrito a administradores' })
  }
}

// ── Super admin (controle global da plataforma) ───────────────
// Funciona nos dois modos de auth: via JWT (usuário com role SUPER_ADMIN) ou via
// API key da conta ADMIN (admin-key). Centraliza a regra usada para bypass de
// quota e visibilidade de recursos administrativos.
export function isSuperAdmin(request: FastifyRequest): boolean {
  // Humano (JWT/cookie do painel): decide ESTRITAMENTE pelo papel do usuário.
  // Assim, um usuário comum que por acaso pertence à conta ADMIN NÃO herda
  // poderes de super admin (evita escalonamento de privilégio).
  if (request.authUser) return request.authUser.role === 'SUPER_ADMIN'
  // Máquina (API key, sem usuário): a chave da conta ADMIN é credencial mestre.
  return request.apiClient?.role === 'ADMIN'
}

// Guard: exige super admin (usar depois de authManage/authJwt).
export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!isSuperAdmin(request)) {
    return reply.status(403).send({ error: 'Acesso restrito ao super admin' })
  }
}

// Guard: exige dono da conta (OWNER) ou super admin — para o self-service de time
// (OWNER gerencia os MEMBERs da própria conta). API key de máquina (sem authUser)
// NÃO é tratada como owner deste fluxo humano. Usar depois de authJwt.
export async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  const role = request.authUser?.role
  if (role !== 'OWNER' && role !== 'SUPER_ADMIN') {
    return reply.status(403).send({ error: 'Acesso restrito ao dono da conta' })
  }
}

// Escopo de instância por papel: um MEMBER (login humano) só enxerga as instâncias
// das quais é dono (ownerUserId). OWNER, super admin e acesso por API key (máquina)
// retornam undefined → enxergam todas as instâncias da conta.
export function memberScopeId(request: FastifyRequest): string | undefined {
  return request.authUser?.role === 'MEMBER' ? request.authUser.id : undefined
}

// Alias de compatibilidade com imports existentes
export const authMiddleware = authAccount
