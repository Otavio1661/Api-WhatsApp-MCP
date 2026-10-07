# Modo demonstração

Veja o painel "cheio" (instâncias, mensagens, campanhas, webhooks) **sem WhatsApp real**.
Serve para conhecer o projeto, tirar capturas de tela e testar o painel e o MCP.

> Tudo é fictício: telefones `55000000xxxxx`, e-mails `@example.com`, webhooks em `*.example.com`.
> O provedor é **simulado** (não fala com o WhatsApp) e o QR exibido é ilustrativo: nenhum celular o lê.
> Para enviar mensagens de verdade, configure um provedor real (veja [providers.md](providers.md)).

## Passo a passo

Pré-requisitos: Node 20+, Docker.

```bash
git clone https://github.com/Otavio1661/Api-WhatsApp-MCP.git && cd Api-WhatsApp-MCP
cp .env.example .env     # preencha JWT_SECRET, SECRETS_ENCRYPTION_KEY e a senha do banco
                         # EVOLUTION_API_KEY pode ser qualquer valor (ex.: demo): ativa o provedor simulado
docker compose -f docker-compose.example.yml up -d postgres redis
npm ci && npx prisma migrate deploy && npm run build

npm run demo:seed        # cria os dados fictícios (recusa rodar com NODE_ENV=production)
npm run demo:provider &  # provedor simulado em 127.0.0.1:8080
npm start                # painel em http://localhost:3000/admin
```

Login: `admin@example.com` / `demo123456`.

O que você vai ver: 6 instâncias (4 conectadas, 1 aguardando QR, 1 desconectada), cerca de 520
mensagens em vários status, 2 campanhas, 3 webhooks e 2 usuários membros. Para apagar tudo:
`npm run demo:seed -- --reset`.

Nunca use este modo em produção: as senhas da demonstração são públicas.
