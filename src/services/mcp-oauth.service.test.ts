// src/services/mcp-oauth.service.test.ts
// Testes do estado Redis do fluxo OAuth do MCP — mock in-memory de verdade
// (Map), não stub estático, já que a corretude aqui depende de round-trip
// real (guardar → ler → apagar).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redisMock = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    __store: store,
  }
})
vi.mock('../utils/redis', () => ({ redis: redisMock }))

import {
  registerClient,
  getClient,
  createPendingAuthorization,
  getPendingAuthorization,
  deletePendingAuthorization,
  createAuthorizationCode,
  consumeAuthorizationCode,
  verifyPkce,
} from './mcp-oauth.service'
import { randomBytes, createHash } from 'node:crypto'

beforeEach(() => {
  redisMock.__store.clear()
  vi.clearAllMocks()
})

describe('registerClient / getClient', () => {
  it('registra um client e recupera pelo client_id', async () => {
    const client = await registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] })
    expect(client.client_id).toBeTruthy()
    expect(client.token_endpoint_auth_method).toBe('none')

    const found = await getClient(client.client_id)
    expect(found).toEqual(client)
  })

  it('client inexistente devolve null', async () => {
    expect(await getClient('nao-existe')).toBeNull()
  })
})

describe('autorização pendente', () => {
  it('cria, lê (sem apagar) e depois apaga explicitamente', async () => {
    const opaque = await createPendingAuthorization({
      client_id: 'c1',
      redirect_uri: 'https://x.com/cb',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
    })

    const first = await getPendingAuthorization(opaque)
    expect(first?.client_id).toBe('c1')

    // Leitura de novo (sem ter apagado) — precisa continuar lá, pro caso de
    // credencial errada reexibir o form sem perder o contexto OAuth.
    const second = await getPendingAuthorization(opaque)
    expect(second?.client_id).toBe('c1')

    await deletePendingAuthorization(opaque)
    expect(await getPendingAuthorization(opaque)).toBeNull()
  })
})

describe('código de autorização — single-use', () => {
  it('consumir apaga — segunda tentativa com o mesmo code falha', async () => {
    const code = await createAuthorizationCode({
      userId: 'u1',
      apiClientId: 'a1',
      accountRole: 'CLIENT',
      client_id: 'c1',
      redirect_uri: 'https://x.com/cb',
      code_challenge: 'abc',
    })

    const first = await consumeAuthorizationCode(code)
    expect(first?.userId).toBe('u1')

    const second = await consumeAuthorizationCode(code)
    expect(second).toBeNull()
  })

  it('code inexistente/expirado devolve null', async () => {
    expect(await consumeAuthorizationCode('nunca-existiu')).toBeNull()
  })
})

describe('verifyPkce', () => {
  it('aceita quando SHA-256(code_verifier) bate com code_challenge', () => {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(verifyPkce(verifier, challenge)).toBe(true)
  })

  it('rejeita verifier errado', () => {
    const challenge = createHash('sha256').update('verifier-certo').digest('base64url')
    expect(verifyPkce('verifier-errado', challenge)).toBe(false)
  })
})
