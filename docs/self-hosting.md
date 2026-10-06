# Hospedagem própria (self-hosting)

## Requisitos

- Docker (ou Node 20+), PostgreSQL 16, Redis 7
- Pelo menos um provedor de WhatsApp (veja [provedores](providers.md))
- Um proxy reverso com TLS na frente do app (Caddy, nginx, Traefik...)

## Deploy com Docker Compose

```bash
cp .env.example .env
# 1) preencha API_SECRET, JWT_SECRET (openssl rand -base64 48) e SECRETS_ENCRYPTION_KEY (openssl rand -base64 32)
# 2) defina POSTGRES_PASSWORD (openssl rand -hex 24) e, para os provedores opcionais, EVOLUTION_API_KEY / WUZAPI_ADMIN_TOKEN
docker compose -f docker-compose.example.yml up -d --build
```

O serviço `migrate` roda `prisma migrate deploy` uma vez; o app inicia depois que ele termina.
Confira `GET /health` (devolve `200` com `{status, version, uptimeSec, checks:{database,redis}}`,
ou `503` quando alguma dependência está fora do ar).

## Primeiro administrador

Defina `ADMIN_SEED_EMAIL` e `ADMIN_SEED_PASSWORD` e rode o seed a partir de um checkout
apontado para o banco de produção:

```bash
DATABASE_URL=... DIRECT_DATABASE_URL=... SECRETS_ENCRYPTION_KEY=... JWT_SECRET=... API_SECRET=... \
ADMIN_SEED_EMAIL=voce@example.com ADMIN_SEED_PASSWORD='uma-senha-forte' npm run db:seed
```

> O seed também cria **dados fictícios de desenvolvimento** (API keys de demonstração fixas,
> como `dev-key-123456`). Use-o apenas em bancos de desenvolvimento. Em produção, crie o
> administrador por SQL/script próprio ou apague os registros de demonstração logo após o seed.

## Proxy reverso

- Termine o TLS no proxy e encaminhe para a porta do app (padrão `3000`).
- Defina `PUBLIC_BASE_URL`, `PUBLIC_API_URL` e `PUBLIC_PANEL_URL` com as URLs HTTPS públicas.
- Encaminhe `/.well-known/oauth-*` e `/mcp*` para o app (necessário para o servidor MCP).
- Não remova nem sobrescreva o cabeçalho `Content-Security-Policy` enviado pelo app.
- Atrás de um pooler como o PgBouncer (modo transação), defina `DIRECT_DATABASE_URL` com uma
  conexão direta ao Postgres: o schema engine do Prisma precisa de prepared statements nas migrations.

## Atualizações

```bash
git pull
docker compose -f docker-compose.example.yml up -d --build   # o migrate roda primeiro
```

Sempre faça backup do banco antes de atualizar. As migrations só avançam (sem rollback).

## Backups

Faça backup do PostgreSQL (`pg_dump`) **e** do valor de `SECRETS_ENCRYPTION_KEY`: sem a chave,
os tokens e API keys criptografados de um banco restaurado não podem ser descriptografados.
O Redis guarda apenas filas, contadores de limite e sessões (perdê-lo desloga os usuários e
descarta os jobs enfileirados).

## Escala

- `CLUSTER_WORKERS` roda vários workers Node em um mesmo contêiner.
- `SEND_QUEUE_LANES` e `SEND_WORKER_CONCURRENCY` ajustam as filas de envio (uma instância
  sempre cai na mesma faixa). O gargalo prático é o espaçamento anti-ban por número
  (`SEND_DELAY_MIN` / `SEND_DELAY_MAX`), não a infraestrutura: adicione números, não CPUs.
