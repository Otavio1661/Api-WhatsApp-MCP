# Configuration

All configuration is read from environment variables (see `.env.example`). The app
refuses to start outside development with the default `JWT_SECRET` / `API_SECRET`.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` enables relaxed defaults; use `production` in real deployments |
| `PORT` | `3000` | HTTP port |
| `API_SECRET` | dev default | Machine-to-machine secret (**required** outside development) |
| `JWT_SECRET` | dev default | Signs human-login JWTs (**required** outside development) |
| `JWT_EXPIRES_IN` | `7d` | Absolute JWT lifetime (also the MCP OAuth `expires_in`) |
| `SESSION_IDLE_TIMEOUT_MIN` | `30` | Idle session timeout, enforced in Redis (sliding) |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Base URL used to build instance `apiUrl` and webhook URLs |
| `PUBLIC_API_URL` | `PUBLIC_BASE_URL` | Public API URL shown in the docs examples |
| `PUBLIC_PANEL_URL` | `http://localhost:3000` | Public panel origin (restricts CORS when panel and API are on different hosts) |
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `DIRECT_DATABASE_URL` | — | Direct connection used by `prisma migrate` (use when `DATABASE_URL` goes through a transaction-mode pooler) |
| `SECRETS_ENCRYPTION_KEY` | — | AES-256-GCM master key (`openssl rand -base64 32`). Required to create instances/tenants |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `localhost` / `6379` / — | Redis for queues and cache |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | `http://localhost:8080` / — | Evolution API provider (enabled when the key is set) |
| `WUZAPI_URL` / `WUZAPI_ADMIN_TOKEN` | `http://localhost:8888` / — | WuzAPI provider |
| `WA_CLOUD_TOKEN` / `WA_CLOUD_PHONE_NUMBER_ID` | — | WhatsApp Cloud API provider |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — / `gemini-flash-lite-latest` | Optional audio transcription for the MCP bridge |
| `SEND_DELAY_MIN` / `SEND_DELAY_MAX` | `2000` / `5000` | Random delay (ms) between sends of the same number |
| `MAX_MESSAGES_PER_NUMBER_DAY` | `200` | Daily limit per number |
| `SEND_WORKER_CONCURRENCY` | `5` | Messages processed concurrently per queue lane |
| `SEND_QUEUE_LANES` | `1` | Number of send queues; each instance always lands on the same lane |
| `DEFAULT_RATE_LIMIT` | `100` | Requests/minute for accounts without their own limit |
| `LOGIN_MAX_TENTATIVAS_CONTA` / `LOGIN_JANELA_CONTA_MIN` | `5` / `15` | Login throttle per IP+e-mail |
| `LOGIN_MAX_TENTATIVAS_IP` / `LOGIN_JANELA_IP_MIN` | `20` / `15` | Login throttle per IP |
| `LOGIN_MAX_TENTATIVAS_DISPOSITIVO` / `LOGIN_JANELA_DISPOSITIVO_MIN` | `20` / `15` | Login throttle per device cookie |
| `LOGIN_IP_ALLOWLIST` | — | Comma-separated IPs that are never throttled |
| `BAN_WEBHOOK_URL` / `ALERT_EMAIL` | — | Optional ban alert targets |
| `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` / `ADMIN_SEED_NAME` | — / — / `Administrator` | Initial super admin created by `npm run db:seed` (both empty = none) |
| `MCP_BRIDGE_ENABLED` | `true` | `false` sends no bridge instructions to MCP clients |
| `MCP_BRIDGE_TRIGGER_WORD` | `Claude` | Word that opens the bridge "control chat" |
| `MCP_BRIDGE_REPLY_PREFIX` | `<trigger>: ` | Prefix of every assistant reply on WhatsApp |
| `MCP_BRIDGE_INSTRUCTIONS` / `MCP_BRIDGE_INSTRUCTIONS_FILE` | — | Replace the whole bridge text (`{{TRIGGER_WORD}}` and `{{REPLY_PREFIX}}` are substituted) |
| `CLUSTER_WORKERS` | — | Number of Node cluster workers (optional) |
