# Contributing

Thanks for your interest in ApiEnvios!

## Development setup

```bash
npm install
cp .env.example .env
docker compose -f docker-compose.example.yml up -d postgres redis
npx prisma migrate deploy && npx prisma generate
npm run dev
```

## Before opening a pull request

```bash
npm run build     # type-check + compile
npm test          # vitest; no external infrastructure required
npx prisma validate
bash scripts/check-no-secrets.sh
```

- Keep changes focused; add or update tests for behaviour changes.
- If you add or change an MCP tool, run `npm run docs:mcp-tools` and commit the regenerated `docs/mcp-tools.md` (CI runs `npm run docs:mcp-tools:check`).
- Database changes need a new Prisma migration (`npx prisma migrate dev --name <change>`);
  never edit `prisma/migrations/0_init`.
- Never commit secrets, real phone numbers, real e-mail addresses or production data. Use
  fictional values (`5544999990000`-style numbers, `example.com` domains) in tests and docs.
- Security fixes: follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Commit style

Short imperative subject (`fix: ...`, `feat: ...`, `docs: ...`). By contributing you agree
that your contribution is licensed under the Apache License 2.0.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
