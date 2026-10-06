# Api-WhatsApp-MCP (ApiEnvios)

Open-source, **multi-tenant WhatsApp sending platform** with a **number pool per
instance**, **opt-in fallback across three providers**, anti-ban / anti-flood
protection, a web admin panel, a REST API and a **remote MCP server** (OAuth 2.1)
so AI assistants such as Claude can manage the account and even chat over WhatsApp.

Stack: Node 20+ · TypeScript · Fastify 5 · Prisma 5 (PostgreSQL 16) · Redis 7 + BullMQ ·
Zod · Pino · Eta + Alpine.js (panel) · Vitest · Docker.

> Status: `0.1.0`, extracted from a production system. APIs may still change before `1.0`.

## Architecture

```
Account (ApiClient / tenant)
  ├── Users (OWNER / MEMBER)            ── JWT login (panel / API)
  └── Instances                         ── one "instance" = a POOL of numbers
        └── Numbers (InstanceNumber)    ── each number = one real provider session
              ├── 1. Evolution API   (text/media, primary)
              ├── 2. WuzAPI          (text/media + buttons, location, contact, polls, lists)
              └── 3. WhatsApp Cloud  (official, paid fallback)
```

You send to an **instance** and the router picks the best **CONNECTED** number
(anti-ban rotation), preferring a **WuzAPI** number when the payload needs rich
features (buttons / location / contact / poll / list). Evolution and Cloud API do
not support those types and fail explicitly (they never silently degrade to
text). A detected ban marks the number `BANNED` and fires a webhook.

## Authentication and roles

| Authentication | Header | Used for |
|---|---|---|
| **Instance token** | `Token: <token>` | Client apps sending through one specific instance |
| **Account API key** | `x-api-key: <key>` | Multi-instance management (instance chosen in the body) |
| **JWT (human login)** | `Authorization: Bearer <jwt>` or panel cookie | People (panel / API / MCP), with a role |

| Resource | MEMBER | OWNER (account owner) | Super admin |
|---|:---:|:---:|:---:|
| Send / campaigns / status | yes (own instances) | yes (account) | yes (global) |
| See instances | only **their own** (`ownerUserId`) | all in the account | all |
| Metrics | their instances | account | account |
| Create / edit / delete instance | own | account | any |
| Assign instance owner | no | yes | yes |
| Manage members (`/v1/account/users`) | no | yes (MEMBER only) | yes |
| Account webhooks | — | yes | yes |
| Admin: accounts / users / global instances (`/v1/admin/*`) | no | no | yes |

## Quick start

### With Docker Compose

```bash
git clone https://github.com/Otavio1661/Api-WhatsApp-MCP.git && cd Api-WhatsApp-MCP
cp .env.example .env
# Fill in API_SECRET, JWT_SECRET, SECRETS_ENCRYPTION_KEY (openssl rand -base64 32)
# and POSTGRES_PASSWORD (openssl rand -hex 24)
docker compose -f docker-compose.example.yml up -d --build
```

The API and the panel listen on `http://localhost:3000` (panel at `/admin`).
Create the first admin by setting `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` and
running `npm run db:seed` from a checkout pointed at the same database (the production
image does not ship the dev toolchain). See [docs/self-hosting.md](docs/self-hosting.md).

### Local development

```bash
npm install
cp .env.example .env                 # DATABASE_URL, REDIS_*, JWT_SECRET, API_SECRET, SECRETS_ENCRYPTION_KEY...
docker compose -f docker-compose.example.yml up -d postgres redis
npx prisma migrate deploy && npx prisma generate
npm run db:seed                      # DEV ONLY: fictional demo data (see prisma/seed.ts)
npm run dev
```

## Web panel (`/admin`)

JWT login (httpOnly cookie). Screens by role: **Instances** (status derived from the
pool), **Docs** (API reference filtered by role), **Team** (OWNER: members and instance
owners) and **Administration** (super admin: accounts and users).

## REST API (summary)

```
POST /v1/instance/:id/messages/chat     { to, body }
POST /v1/instance/:id/messages/media    { to, type, mediaUrl, caption }
POST /v1/messages                       { to, type, text|mediaUrl, instanceId?, scheduledAt? }
POST /v1/campaigns                      { to:[...], text|mediaUrl, instanceId?, externalIdPrefix? }
GET  /v1/messages/:id                   message status
GET  /v1/messages?status=&page=&limit=  history
GET/POST/PATCH/DELETE /v1/instances[/:id]   (+ /connect, /qr, /status, /numbers ...)
GET  /v1/metrics?days=30
POST /v1/webhooks                       { url, events[], secret? }
GET/POST/PATCH/DELETE /v1/account/users (OWNER) manage MEMBERs
GET/POST/PATCH/DELETE /v1/admin/...     (super admin) accounts, users, global instances
GET  /health                            { status, version, uptimeSec, checks:{database,redis} }
```

The panel serves the full, role-filtered reference at `/admin/docs`.

## Webhooks

Events: `BAN_DETECTED`, `NUMBER_DISCONNECTED`, `NUMBER_ROTATED`, `MESSAGE_FAILED`,
`MESSAGE_DELIVERED`, `PROVIDER_DOWN`. Delivery is asynchronous with retry/backoff
(BullMQ). With a `secret`, every POST carries:

```
X-ApiEnvios-Event:     <event>
X-ApiEnvios-Timestamp: <epoch ms>
X-ApiEnvios-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<body>">
```

Validate by recomputing the HMAC over `${timestamp}.${rawBody}` with your secret.
Webhook URLs are checked against SSRF (private, loopback and cloud-metadata
addresses are rejected).

## Anti-ban and anti-flood

- Per-instance send spacing (Redis lock + random delay).
- Per-recipient hourly cap per account (`ApiClient.maxPerRecipientPerHour`, `0` = unlimited);
  exceeding it returns `429 Retry-After` without queueing.
- Warm-up for new numbers, automatic rotation on ban, daily limit per number.

## MCP server (AI assistants)

`POST /mcp` exposes **30 tools** (instances, messages, inbound messages, campaigns,
webhooks, members, metrics) over Streamable HTTP (stateless) with **OAuth 2.1 + PKCE** and
Dynamic Client Registration. Every tool calls the regular REST route with the logged-in
user's JWT, so tenant scoping, role checks and anti-flood apply exactly as in the API. An
optional **WhatsApp <-> assistant bridge** lets a connected assistant answer messages on
your behalf (fully configurable).

Quick start (replace the URL with your public HTTPS API URL):

```bash
# Claude Code
claude mcp add --transport http apienvios https://api.example.com/mcp   # then run /mcp to log in

# OpenAI Codex CLI
codex mcp add apienvios --url https://api.example.com/mcp
codex mcp login apienvios --oauth-client-registration dcr
```

| Client | Status of the connection guide |
|---|---|
| [Claude Code](docs/mcp/clients/claude-code.md) | Verified against the vendor docs |
| [claude.ai / Claude Desktop](docs/mcp/clients/claude-ai-desktop.md) | Verified against the vendor docs |
| [OpenAI Codex](docs/mcp/clients/codex.md) | Verified against the vendor docs |
| [Cursor](docs/mcp/clients/cursor.md) | Verified; the vendor says DCR is unsupported, workaround untested |
| [Windsurf](docs/mcp/clients/windsurf.md), [Gemini CLI](docs/mcp/clients/gemini-cli.md), [Zed](docs/mcp/clients/zed.md) | Verified against the vendor docs |
| [ChatGPT](docs/mcp/clients/chatgpt.md), [VS Code](docs/mcp/clients/vscode.md), [Cline](docs/mcp/clients/cline.md), [Continue](docs/mcp/clients/continue.md) | Partial (some points unconfirmed) |
| [Any stdio-only client](docs/mcp/clients/mcp-remote.md) | Via the `mcp-remote` bridge |

Full documentation (Brazilian Portuguese, with an [English summary](docs/en/mcp-overview.md)):
[how it works](docs/mcp/overview.md), [connect a client](docs/mcp/connect.md),
[tool reference](docs/mcp-tools.md), [security](docs/mcp/security.md),
[troubleshooting](docs/mcp/troubleshooting.md) and [examples](docs/mcp/examples.md).

## Secrets encrypted at rest

`Instance.token`, `Instance.webhookSecret` and `ApiClient.apiKey` are live credentials that
must be shown in clear text in the panel/API after creation, so they are protected with
reversible symmetric encryption (AES-256-GCM) instead of a hash:

- Implementation in `src/utils/secrets-crypto.ts`: random IV per value, stored as
  `iv:tag:ciphertext` (base64). The master key comes from `SECRETS_ENCRYPTION_KEY`
  (`openssl rand -base64 32`), never from the schema, migrations or git.
- A **blind index** (`tokenHash` / `apiKeyHash`, HMAC-SHA256 derived from the master key)
  lets the auth middleware look credentials up without decrypting every row.
- Without `SECRETS_ENCRYPTION_KEY`, creating a new instance or tenant fails.

## Pluggable external login (optional)

By default users authenticate with a local bcrypt hash. To delegate passwords to another
system (LDAP, SSO, an internal identity service), register an `ExternalAuthProvider`
(`src/services/external-auth.ts`) at startup and set `User.externalId` on the matching
users. A user with an `externalId` and no registered provider cannot log in.

## Documentation

- [docs/self-hosting.md](docs/self-hosting.md) — deploy, reverse proxy, upgrades, backups
- [docs/configuration.md](docs/configuration.md) — every environment variable
- [docs/providers.md](docs/providers.md) — Evolution API, WuzAPI, WhatsApp Cloud API
- [docs/mcp/overview.md](docs/mcp/overview.md) — MCP: how it works, OAuth flow, sessions, limits, WhatsApp bridge (pt-BR; [English summary](docs/en/mcp-overview.md))
- [docs/mcp/connect.md](docs/mcp/connect.md) — connect Claude Code, Codex, Cursor, Gemini CLI and more
- [docs/mcp-tools.md](docs/mcp-tools.md) — reference of the 30 tools (generated from the code)
- [docs/mcp/security.md](docs/mcp/security.md), [docs/mcp/troubleshooting.md](docs/mcp/troubleshooting.md), [docs/mcp/examples.md](docs/mcp/examples.md)
- [docs/security.md](docs/security.md) — security model and hardening checklist

## Tests

```bash
npm test          # vitest (unit + integration with mocked Prisma/Redis; no infrastructure needed)
npm run build     # type-check + compile
npm run docs:mcp-tools:check   # fails if docs/mcp-tools.md is out of date (regenerate with npm run docs:mcp-tools)
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Please report
vulnerabilities privately, never in a public issue.

## License

[Apache-2.0](LICENSE).
