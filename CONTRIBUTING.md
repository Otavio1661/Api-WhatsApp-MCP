# Contribuindo

Obrigado pelo interesse no ApiEnvios!

## Ambiente de desenvolvimento

```bash
npm install
cp .env.example .env
docker compose -f docker-compose.example.yml up -d postgres redis
npx prisma migrate deploy && npx prisma generate
npm run dev
```

## Antes de abrir um pull request

```bash
npm run build     # checagem de tipos + compilação
npm test          # vitest; não precisa de infraestrutura externa
npx prisma validate
bash scripts/check-no-secrets.sh
```

- Mantenha as mudanças focadas; adicione ou atualize testes quando o comportamento mudar.
- Se adicionar ou alterar uma tool do MCP, rode `npm run docs:mcp-tools` e faça commit do `docs/mcp-tools.md` regenerado (o CI roda `npm run docs:mcp-tools:check`).
- Mudanças no banco exigem uma nova migration do Prisma (`npx prisma migrate dev --name <mudança>`);
  nunca edite `prisma/migrations/0_init`.
- Nunca faça commit de segredos, telefones reais, e-mails reais nem dados de produção. Use
  valores fictícios (números no estilo `5544999990000`, domínios `example.com`) em testes e na documentação.
- Correções de segurança: siga o [SECURITY.md](SECURITY.md) em vez de abrir uma issue pública.

## Estilo de commit

Assunto curto, no imperativo (`fix: ...`, `feat: ...`, `docs: ...`). Ao contribuir, você concorda
que sua contribuição é licenciada sob a Apache License 2.0.

## Código de conduta

A participação é regida pelo [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
