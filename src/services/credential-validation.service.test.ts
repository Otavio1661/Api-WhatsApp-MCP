import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }))

import { prisma } from '../utils/prisma'
import { hashPassword } from '../utils/password'
import { validarCredenciais } from './credential-validation.service'
import { setExternalAuthProvider } from './external-auth'

const findUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>
const apiClient = { id: 'tenant-1', name: 'Tenant', active: true }

describe('validarCredenciais', () => {
  beforeEach(() => findUnique.mockReset())
  afterEach(() => setExternalAuthProvider(null))

  it('local account: accepts the right password and rejects the wrong one', async () => {
    const passwordHash = await hashPassword('correct-horse')
    findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.com', passwordHash, externalId: null, apiClient })
    expect((await validarCredenciais('a@example.com', 'correct-horse')).ok).toBe(true)
    expect((await validarCredenciais('a@example.com', 'wrong')).ok).toBe(false)
  })

  it('unknown user and inactive account are rejected', async () => {
    findUnique.mockResolvedValue(null)
    expect((await validarCredenciais('nobody@example.com', 'x')).ok).toBe(false)
    findUnique.mockResolvedValue({ id: 'u2', passwordHash: 'x', externalId: null, apiClient: { ...apiClient, active: false } })
    expect((await validarCredenciais('a@example.com', 'x')).ok).toBe(false)
  })

  it('user with externalId and NO provider registered can never log in', async () => {
    const passwordHash = await hashPassword('local-password')
    findUnique.mockResolvedValue({ id: 'u3', email: 'b@example.com', passwordHash, externalId: 'ext-1', apiClient })
    expect((await validarCredenciais('b@example.com', 'local-password')).ok).toBe(false)
  })

  it('user with externalId is verified by the registered provider (local hash is ignored)', async () => {
    const verifyPassword = vi.fn(async (id: string, pw: string) => id === 'ext-1' && pw === 'from-provider')
    setExternalAuthProvider({ verifyPassword })
    const passwordHash = await hashPassword('local-password')
    findUnique.mockResolvedValue({ id: 'u4', email: 'c@example.com', passwordHash, externalId: 'ext-1', apiClient })
    expect((await validarCredenciais('c@example.com', 'from-provider')).ok).toBe(true)
    expect((await validarCredenciais('c@example.com', 'local-password')).ok).toBe(false)
    expect(verifyPassword).toHaveBeenCalledTimes(2)
  })
})
