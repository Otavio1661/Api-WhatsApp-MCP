# Security model

## What the app protects

- **Tenant isolation**: every query is scoped by account; MEMBER users only see the instances
  they own. The MCP server reuses the REST routes, so it cannot bypass these rules.
- **Credentials at rest**: instance tokens, webhook secrets and API keys are encrypted with
  AES-256-GCM (`SECRETS_ENCRYPTION_KEY`); lookups use an HMAC blind index. Passwords use bcrypt.
- **Login brute-force protection** in three layers (IP+e-mail, IP, device cookie) backed by Redis.
- **Sessions**: JWT + a Redis session record with a sliding idle timeout; logout and admin
  deletion revoke it immediately.
- **SSRF guard** on webhook URLs (private ranges, loopback, link-local and cloud-metadata
  addresses are rejected).
- **Signed webhooks**: `X-ApiEnvios-Signature` is an HMAC-SHA256 over `<timestamp>.<body>`.
- **Anti-flood**: per-recipient hourly cap and per-number daily limit.
- **Audit log** for destructive super-admin actions (no secrets in the snapshot).
- **Headers**: strict CSP (relaxed only for the panel and the OAuth login form), CORS limited to
  the panel origin, rate limiting.
- **MCP OAuth**: PKCE S256 only, single-use 90 s authorization codes, redirect URI validation.

## Hardening checklist

- [ ] Set strong, unique `API_SECRET`, `JWT_SECRET` and `SECRETS_ENCRYPTION_KEY` (the app refuses to start in production with the dev defaults).
- [ ] Back up `SECRETS_ENCRYPTION_KEY` separately from the database.
- [ ] Serve everything over HTTPS; set the three `PUBLIC_*` URLs accordingly.
- [ ] Do not expose PostgreSQL, Redis, Evolution API or WuzAPI to the internet.
- [ ] Create the first admin with a strong password; do not keep the demo seed data in production.
- [ ] Restrict the panel to trusted networks if possible (`LOGIN_IP_ALLOWLIST` only *exempts* IPs from throttling).
- [ ] Give assistants connected through MCP the least-privileged user (MEMBER).
- [ ] Monitor `/health` and the ban webhook (`BAN_WEBHOOK_URL`).

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
