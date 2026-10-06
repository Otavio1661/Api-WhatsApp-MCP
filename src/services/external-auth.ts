// src/services/external-auth.ts
// Optional pluggable identity provider (SSO / central password store).
//
// By default NO provider is registered and every user authenticates with the
// bcrypt hash stored in `User.passwordHash`. A deployment that keeps passwords
// somewhere else (LDAP, an in-house identity service, ...) can register a
// provider at startup and mark the matching users with `User.externalId`.
//
// Safe default: a user that has an `externalId` but no registered provider can
// NOT log in (it never falls back to the local hash).

export interface ExternalAuthProvider {
  /** Returns true when `password` is valid for the external identity. */
  verifyPassword(externalId: string, password: string): Promise<boolean>
  /** Optional: persists a new password in the external store. */
  changePassword?(externalId: string, newPassword: string): Promise<boolean>
}

let provider: ExternalAuthProvider | null = null

export function setExternalAuthProvider(next: ExternalAuthProvider | null): void {
  provider = next
}

export function getExternalAuthProvider(): ExternalAuthProvider | null {
  return provider
}
