// src/utils/recipient-rate-limit.ts
// Limite anti-flood POR DESTINATÁRIO, contado POR CONTA (ApiClient).
//
// Problema: uma conta pode (acidentalmente — ex.: loop de requisições — ou de má-fé)
// bombardear o MESMO número de destino, gerando spam e risco de ban. O espaçamento
// anti-ban do rate-gate é por instância; o rate-limit do @fastify/rate-limit é por
// req/min da conta. Nenhum dos dois limita "quantas vezes a CONTA fala com o MESMO
// número por hora".
//
// Solução: contador de janela fixa de 1h no Redis, chave `rl:rcpt:<apiClientId>:<toPhone>`,
// somando todas as instâncias da conta. A contagem é atômica via Lua (mesmo padrão do
// rate-gate): INCR + PEXPIRE no primeiro acesso; se ultrapassar o teto, DECR de volta
// (o contador nunca excede o limite) e sinaliza bloqueio.
import type { FastifyReply, FastifyRequest } from 'fastify'
import { redis } from './redis'

const WINDOW_MS = 60 * 60 * 1000 // 1 hora (janela fixa)

// Incrementa de forma atômica e decide o bloqueio numa única ida ao Redis.
// Retorna o contador atual (>0) se permitido, ou -1 se o limite foi atingido.
const CHECK_LUA = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
if count > tonumber(ARGV[1]) then
  redis.call("DECR", KEYS[1])
  return -1
end
return count
`

export interface RecipientLimitResult {
  allowed: boolean
  limit: number
  count: number          // quantos já contam na janela (após esta tentativa, se permitida)
  retryAfterSec: number  // segundos até a janela liberar (0 quando permitido)
}

/**
 * Verifica e consome uma "vaga" do limite por destinatário da conta.
 * `limit <= 0` significa ilimitado: retorna allowed=true sem tocar o Redis.
 * Deve ser chamada UMA vez por mensagem imediata, ANTES de criar/enfileirar o envio.
 */
export async function checkRecipientHourlyLimit(
  apiClientId: string,
  toPhone: string,
  limit: number,
): Promise<RecipientLimitResult> {
  if (!limit || limit <= 0) {
    return { allowed: true, limit: 0, count: 0, retryAfterSec: 0 }
  }

  const key = `rl:rcpt:${apiClientId}:${toPhone}`
  const result = (await redis.eval(CHECK_LUA, 1, key, String(limit), String(WINDOW_MS))) as number

  if (result === -1) {
    // Bloqueado: lê o TTL restante para informar o Retry-After.
    const pttl = await redis.pttl(key)
    const retryAfterSec = pttl > 0 ? Math.ceil(pttl / 1000) : Math.ceil(WINDOW_MS / 1000)
    return { allowed: false, limit, count: limit, retryAfterSec }
  }

  return { allowed: true, limit, count: result, retryAfterSec: 0 }
}

// guarda compartilhada para os pontos de entrada de ENVIO IMEDIATO que
// respondem UMA mensagem por requisição — POST /messages (messages.route.ts) e os 3
// endpoints de token de instância, POST /instance/:id/messages/{chat,media,send}
// (instances.route.ts). Antes desta função, o bloco "chama checkRecipientHourlyLimit,
// loga e responde 429 com Retry-After" estava copiado 4 vezes (1x em messages.route.ts,
// 3x — idênticas entre si — em instances.route.ts, adicionadas depois).
//
// Ficam de fora de propósito (continuam chamando `checkRecipientHourlyLimit` direto):
// - POST /campaigns (campaigns.route.ts): cada destinatário vira uma ENTRADA num array
//   de resultados agregado, não uma resposta HTTP isolada — o padrão "escreve a reply e
//   retorna boolean" não se aplica.
// - scheduler.ts (promoção SCHEDULED→QUEUED): roda em lote fora de um request/reply
//   HTTP, decide manter a mensagem em SCHEDULED em vez de responder 429.
//
// `logPrefix` preserva o prefixo de log de cada chamador original (`[Messages]` em
// messages.route.ts, `[Instances]` em instances.route.ts) sem mudar o texto já
// existente nos logs.
//
// Retorna `true` se o chamador pode prosseguir (criar a Message); `false` se a
// reply já foi escrita (o handler deve retornar sem criar a Message).
export async function enforceRecipientHourlyLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  apiClientId: string,
  toPhone: string,
  limit: number,
  logPrefix = '[Messages]',
): Promise<boolean> {
  const result = await checkRecipientHourlyLimit(apiClientId, toPhone, limit)
  if (!result.allowed) {
    request.log.warn(
      `${logPrefix} Limite por destinatário atingido: conta=${apiClientId} to=${toPhone} limite=${result.limit}/h`,
    )
    reply
      .status(429)
      .header('Retry-After', String(result.retryAfterSec))
      .send({
        error: `Limite de ${result.limit} mensagem(ns) por hora para o mesmo número atingido`,
        to: toPhone,
        limit: result.limit,
        retryAfterSec: result.retryAfterSec,
      })
    return false
  }
  return true
}
