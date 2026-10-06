// src/services/credential-validation.service.ts
// Credential validation (e-mail + password) shared by the human login entry
// points: the JSON API (auth.route.ts), the web panel (panel.route.ts) and the
// MCP OAuth /authorize endpoint (mcp-oauth.route.ts).
//
// It does NOT do rate limiting / brute-force protection (verificarBloqueio /
// registrarTentativaFalha): that stays with each caller, because the layer
// identifiers (e.g. device id) are specific to each flow.
import type { ApiClient, User } from '@prisma/client'
import { prisma } from '../utils/prisma'
import { verifyPassword, verifyPasswordDummy } from '../utils/password'
import { getExternalAuthProvider } from './external-auth'

export interface CredencialValidResult {
  ok: boolean
  user?: User & { apiClient: ApiClient }
}

// Users with an `externalId` are verified by the registered ExternalAuthProvider
// (see external-auth.ts); everyone else uses the local bcrypt hash. A dummy
// compare runs for unknown/inactive accounts so the cost matches the real
// branch, closing the timing side channel for e-mail enumeration.
export async function validarCredenciais(email: string, password: string): Promise<CredencialValidResult> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { apiClient: true },
  })

  if (!user || !user.apiClient.active) {
    await verifyPasswordDummy(password)
    return { ok: false }
  }

  let ok: boolean
  if (user.externalId !== null) {
    const external = getExternalAuthProvider()
    if (external) {
      ok = await external.verifyPassword(user.externalId, password)
    } else {
      await verifyPasswordDummy(password)
      ok = false
    }
  } else {
    ok = await verifyPassword(password, user.passwordHash)
  }

  return ok ? { ok: true, user } : { ok: false }
}
