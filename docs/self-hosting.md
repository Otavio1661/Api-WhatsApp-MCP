# Self-hosting

## Requirements

- Docker (or Node 20+), PostgreSQL 16, Redis 7
- At least one WhatsApp provider (see [providers](providers.md))
- A reverse proxy with TLS in front of the app (Caddy, nginx, Traefik...)

## Deploy with Docker Compose

```bash
cp .env.example .env
# 1) fill in API_SECRET, JWT_SECRET (openssl rand -base64 48) and SECRETS_ENCRYPTION_KEY (openssl rand -base64 32)
# 2) set POSTGRES_PASSWORD (openssl rand -hex 24) and, for the optional providers, EVOLUTION_API_KEY / WUZAPI_ADMIN_TOKEN
docker compose -f docker-compose.example.yml up -d --build
```

The `migrate` service runs `prisma migrate deploy` once; the app starts after it finishes.
Check `GET /health` (returns `200` with `{status, version, uptimeSec, checks:{database,redis}}`,
or `503` when a dependency is down).

## First admin

Set `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` and run the seed from a checkout pointed
at the production database:

```bash
DATABASE_URL=... DIRECT_DATABASE_URL=... SECRETS_ENCRYPTION_KEY=... JWT_SECRET=... API_SECRET=... \
ADMIN_SEED_EMAIL=you@example.com ADMIN_SEED_PASSWORD='a-strong-password' npm run db:seed
```

> The seed also creates **fictional development data** (fixed demo API keys such as
> `dev-key-123456`). Use it only on development databases. In production, create the admin
> through your own SQL/script or delete the demo records right after seeding.

## Reverse proxy

- Terminate TLS at the proxy and forward to the app port (default `3000`).
- Set `PUBLIC_BASE_URL`, `PUBLIC_API_URL` and `PUBLIC_PANEL_URL` to the public HTTPS URLs.
- Route `/.well-known/oauth-*` and `/mcp*` to the app (needed for the MCP server).
- Do not strip or override the `Content-Security-Policy` header the app sends.
- Behind a pooler such as PgBouncer (transaction mode), set `DIRECT_DATABASE_URL` to a direct
  Postgres connection: the Prisma schema engine needs prepared statements for migrations.

## Upgrades

```bash
git pull
docker compose -f docker-compose.example.yml up -d --build   # migrate runs first
```

Always back up the database before upgrading. Migrations are forward-only.

## Backups

Back up PostgreSQL (`pg_dump`) **and** the value of `SECRETS_ENCRYPTION_KEY`: without the key,
the encrypted tokens and API keys in a restored database cannot be decrypted. Redis only
holds queues, rate-limit counters and sessions (losing it logs users out and drops queued jobs).

## Scaling

- `CLUSTER_WORKERS` runs several Node workers in one container.
- `SEND_QUEUE_LANES` and `SEND_WORKER_CONCURRENCY` tune the send queues (an instance always
  maps to the same lane). The practical bottleneck is the per-number anti-ban spacing
  (`SEND_DELAY_MIN` / `SEND_DELAY_MAX`), not the infrastructure: add numbers, not CPUs.
