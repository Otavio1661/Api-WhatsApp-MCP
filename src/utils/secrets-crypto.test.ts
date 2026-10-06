// src/utils/secrets-crypto.test.ts
// Cobre a criptografia reversível de segredos de tenant: round-trip,
// detecção de adulteração (tag do GCM), determinismo do hash de busca e os
// erros de configuração (chave ausente/tamanho errado).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  encryptSecret,
  decryptSecret,
  looksEncrypted,
  decryptSecretIfNeeded,
  hashForLookup,
  tryHashForLookup,
  generateSecretValue,
  secretsMatch,
  decryptApiClientSecret,
  decryptInstanceSecrets,
} from './secrets-crypto'

// Chave de 32 bytes válida, só para teste (nunca usar em nenhum ambiente real).
const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

describe('secrets-crypto', () => {
  const originalKey = process.env.SECRETS_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.SECRETS_ENCRYPTION_KEY = TEST_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY
    else process.env.SECRETS_ENCRYPTION_KEY = originalKey
  })

  describe('encryptSecret / decryptSecret', () => {
    it('faz round-trip: decripta exatamente o que foi cifrado', () => {
      const plaintext = 'ck-token-de-instancia-123456'
      const encrypted = encryptSecret(plaintext)
      expect(decryptSecret(encrypted)).toBe(plaintext)
    })

    it('produz ciphertext diferente a cada chamada (IV aleatório)', () => {
      const plaintext = 'mesmo-valor'
      const a = encryptSecret(plaintext)
      const b = encryptSecret(plaintext)
      expect(a).not.toBe(b)
      expect(decryptSecret(a)).toBe(plaintext)
      expect(decryptSecret(b)).toBe(plaintext)
    })

    it('guarda no formato "iv:tag:ciphertext" (3 segmentos base64)', () => {
      const encrypted = encryptSecret('valor-qualquer')
      const parts = encrypted.split(':')
      expect(parts).toHaveLength(3)
      parts.forEach((p) => expect(() => Buffer.from(p, 'base64')).not.toThrow())
    })

    it('lança ao decriptar ciphertext adulterado (tag do GCM não bate)', () => {
      const encrypted = encryptSecret('valor-sensivel')
      const [iv, tag, data] = encrypted.split(':')
      const dataBuf = Buffer.from(data, 'base64')
      dataBuf[0] = dataBuf[0] ^ 0xff // flip de 1 byte no ciphertext
      const tampered = [iv, tag, dataBuf.toString('base64')].join(':')
      expect(() => decryptSecret(tampered)).toThrow()
    })

    it('lança em formato inválido (sem 3 segmentos)', () => {
      expect(() => decryptSecret('nao-e-um-segredo-cifrado')).toThrow()
    })

    it('lança sem SECRETS_ENCRYPTION_KEY configurada', () => {
      delete process.env.SECRETS_ENCRYPTION_KEY
      expect(() => encryptSecret('x')).toThrow(/SECRETS_ENCRYPTION_KEY/)
    })

    it('lança com SECRETS_ENCRYPTION_KEY de tamanho errado', () => {
      process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64')
      expect(() => encryptSecret('x')).toThrow(/32 bytes/)
    })
  })

  describe('looksEncrypted / decryptSecretIfNeeded (transição legado)', () => {
    it('reconhece um valor cifrado por encryptSecret', () => {
      expect(looksEncrypted(encryptSecret('abc'))).toBe(true)
    })

    it('NÃO reconhece um cuid legado em texto puro como cifrado', () => {
      expect(looksEncrypted('ckv8qjg9b0000qzrmn831p7g9')).toBe(false)
      expect(looksEncrypted('dev-instance-token-01')).toBe(false)
    })

    it('decryptSecretIfNeeded faz passthrough em valor legado (texto puro)', () => {
      const legacy = 'dev-instance-token-01'
      expect(decryptSecretIfNeeded(legacy)).toBe(legacy)
    })

    it('decryptSecretIfNeeded decripta um valor já migrado', () => {
      const plaintext = 'token-real-do-cliente'
      expect(decryptSecretIfNeeded(encryptSecret(plaintext))).toBe(plaintext)
    })
  })

  describe('hashForLookup', () => {
    it('é determinístico para o mesmo valor', () => {
      expect(hashForLookup('mesmo-valor')).toBe(hashForLookup('mesmo-valor'))
    })

    it('produz saídas diferentes para valores diferentes', () => {
      expect(hashForLookup('valor-a')).not.toBe(hashForLookup('valor-b'))
    })

    it('retorna hex de 64 caracteres (SHA-256)', () => {
      expect(hashForLookup('qualquer-coisa')).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('generateSecretValue', () => {
    it('gera valores únicos a cada chamada', () => {
      const values = new Set(Array.from({ length: 20 }, () => generateSecretValue()))
      expect(values.size).toBe(20)
    })

    it('gera string url-safe não vazia', () => {
      const value = generateSecretValue()
      expect(value.length).toBeGreaterThan(20)
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/)
    })
  })

  describe('tryHashForLookup (fallback gracioso sem quebrar auth existente)', () => {
    it('retorna o mesmo valor de hashForLookup quando a chave está configurada', () => {
      expect(tryHashForLookup('abc')).toBe(hashForLookup('abc'))
    })

    it('retorna null (em vez de lançar) sem SECRETS_ENCRYPTION_KEY configurada', () => {
      delete process.env.SECRETS_ENCRYPTION_KEY
      expect(tryHashForLookup('abc')).toBeNull()
    })
  })

  describe('decryptApiClientSecret / decryptInstanceSecrets (defensivos)', () => {
    it('decripta apiKey já cifrada', () => {
      const out = decryptApiClientSecret({ id: 'c1', apiKey: encryptSecret('minha-key') })
      expect(out.apiKey).toBe('minha-key')
    })

    it('faz passthrough de apiKey legada (texto puro)', () => {
      const out = decryptApiClientSecret({ id: 'c1', apiKey: 'dev-key-123456' })
      expect(out.apiKey).toBe('dev-key-123456')
    })

    it('não lança quando apiKey está ausente (objeto parcial)', () => {
      const partial: { id: string; apiKey?: string } = { id: 'c1' }
      expect(() => decryptApiClientSecret(partial)).not.toThrow()
    })

    it('decripta token e webhookSecret de uma Instance', () => {
      const out = decryptInstanceSecrets({
        id: 'i1',
        token: encryptSecret('tok-real'),
        webhookSecret: encryptSecret('ws-real'),
      })
      expect(out.token).toBe('tok-real')
      expect(out.webhookSecret).toBe('ws-real')
    })

    it('não lança quando token/webhookSecret estão ausentes (objeto parcial de teste)', () => {
      const partial: { id: string; token?: string; webhookSecret?: string } = { id: 'i1' }
      expect(() => decryptInstanceSecrets(partial)).not.toThrow()
    })
  })

  describe('secretsMatch', () => {
    it('true para valores iguais', () => {
      expect(secretsMatch('abc123', 'abc123')).toBe(true)
    })

    it('false para valores diferentes de mesmo tamanho', () => {
      expect(secretsMatch('abc123', 'abc124')).toBe(false)
    })

    it('false para tamanhos diferentes (sem lançar)', () => {
      expect(secretsMatch('abc', 'abcdef')).toBe(false)
    })
  })
})
