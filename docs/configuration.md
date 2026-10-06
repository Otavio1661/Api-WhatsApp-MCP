# Configuração

Toda a configuração vem de variáveis de ambiente (veja o `.env.example`). Fora do ambiente de
desenvolvimento, o app se recusa a iniciar com os valores padrão de `JWT_SECRET` / `API_SECRET`.

| Variável | Padrão | Descrição |
|---|---|---|
| `NODE_ENV` | `development` | `development` ativa padrões relaxados; use `production` em implantações reais |
| `PORT` | `3000` | Porta HTTP |
| `API_SECRET` | padrão de dev | Segredo máquina a máquina (**obrigatório** fora do desenvolvimento) |
| `JWT_SECRET` | padrão de dev | Assina os JWT do login humano (**obrigatório** fora do desenvolvimento) |
| `JWT_EXPIRES_IN` | `7d` | Duração absoluta do JWT (também é o `expires_in` do OAuth do MCP) |
| `SESSION_IDLE_TIMEOUT_MIN` | `30` | Timeout de inatividade da sessão, aplicado no Redis (deslizante) |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | URL base usada para montar o `apiUrl` das instâncias e as URLs de webhook |
| `PUBLIC_API_URL` | `PUBLIC_BASE_URL` | URL pública da API mostrada nos exemplos da documentação |
| `PUBLIC_PANEL_URL` | `http://localhost:3000` | Origem pública do painel (restringe o CORS quando painel e API ficam em hosts diferentes) |
| `DATABASE_URL` | — (obrigatória) | String de conexão do PostgreSQL |
| `DIRECT_DATABASE_URL` | — | Conexão direta usada pelo `prisma migrate` (use quando a `DATABASE_URL` passa por um pooler em modo transação) |
| `SECRETS_ENCRYPTION_KEY` | — | Chave mestra AES-256-GCM (`openssl rand -base64 32`). Necessária para criar instâncias/tenants |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `localhost` / `6379` / — | Redis para filas e cache |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | `http://localhost:8080` / — | Provedor Evolution API (ativado quando a chave está definida) |
| `WUZAPI_URL` / `WUZAPI_ADMIN_TOKEN` | `http://localhost:8888` / — | Provedor WuzAPI |
| `WA_CLOUD_TOKEN` / `WA_CLOUD_PHONE_NUMBER_ID` | — | Provedor WhatsApp Cloud API |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — / `gemini-flash-lite-latest` | Transcrição de áudio opcional para a ponte do MCP |
| `SEND_DELAY_MIN` / `SEND_DELAY_MAX` | `2000` / `5000` | Atraso aleatório (ms) entre envios do mesmo número |
| `MAX_MESSAGES_PER_NUMBER_DAY` | `200` | Limite diário por número |
| `SEND_WORKER_CONCURRENCY` | `5` | Mensagens processadas em paralelo por faixa (lane) da fila |
| `SEND_QUEUE_LANES` | `1` | Número de filas de envio; cada instância sempre cai na mesma faixa |
| `DEFAULT_RATE_LIMIT` | `100` | Requisições por minuto para contas sem limite próprio |
| `LOGIN_MAX_TENTATIVAS_CONTA` / `LOGIN_JANELA_CONTA_MIN` | `5` / `15` | Limite de tentativas de login por IP+e-mail |
| `LOGIN_MAX_TENTATIVAS_IP` / `LOGIN_JANELA_IP_MIN` | `20` / `15` | Limite de tentativas de login por IP |
| `LOGIN_MAX_TENTATIVAS_DISPOSITIVO` / `LOGIN_JANELA_DISPOSITIVO_MIN` | `20` / `15` | Limite de tentativas de login por cookie de dispositivo |
| `LOGIN_IP_ALLOWLIST` | — | IPs separados por vírgula que nunca sofrem limitação |
| `BAN_WEBHOOK_URL` / `ALERT_EMAIL` | — | Destinos opcionais de alerta de ban |
| `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` / `ADMIN_SEED_NAME` | — / — / `Administrator` | Super admin inicial criado por `npm run db:seed` (os dois vazios = nenhum) |
| `MCP_BRIDGE_ENABLED` | `true` | `false` não envia instruções da ponte aos clientes MCP |
| `MCP_BRIDGE_TRIGGER_WORD` | `Claude` | Palavra que abre o "chat de controle" da ponte |
| `MCP_BRIDGE_REPLY_PREFIX` | `<palavra>: ` | Prefixo de toda resposta do assistente no WhatsApp |
| `MCP_BRIDGE_INSTRUCTIONS` / `MCP_BRIDGE_INSTRUCTIONS_FILE` | — | Substituem o texto inteiro da ponte (`{{TRIGGER_WORD}}` e `{{REPLY_PREFIX}}` são substituídos) |
| `CLUSTER_WORKERS` | — | Número de workers do cluster Node (opcional) |
