# Modelo de segurança

## O que o app protege

- **Isolamento por tenant**: toda consulta é filtrada pela conta; usuários MEMBER só veem as
  instâncias que possuem. O servidor MCP reutiliza as rotas REST, então não consegue contornar
  essas regras.
- **Credenciais em repouso**: tokens de instância, segredos de webhook e API keys são
  criptografados com AES-256-GCM (`SECRETS_ENCRYPTION_KEY`); as buscas usam um blind index HMAC.
  As senhas usam bcrypt.
- **Proteção contra força bruta no login** em três camadas (IP+e-mail, IP, cookie de dispositivo)
  apoiadas no Redis.
- **Sessões**: JWT + um registro de sessão no Redis com timeout de inatividade deslizante;
  logout e exclusão pelo admin a revogam imediatamente.
- **Proteção SSRF** nas URLs de webhook (faixas privadas, loopback, link-local e endereços de
  metadados de nuvem são rejeitados).
- **Webhooks assinados**: `X-ApiEnvios-Signature` é um HMAC-SHA256 sobre `<timestamp>.<corpo>`.
- **Anti-flood**: limite por destinatário por hora e limite diário por número.
- **Log de auditoria** para ações destrutivas do super admin (sem segredos no snapshot).
- **Cabeçalhos**: CSP estrita (relaxada apenas para o painel e para o formulário de login
  OAuth), CORS limitado à origem do painel e limitação de taxa.
- **OAuth do MCP**: somente PKCE S256, códigos de autorização de uso único com 90 s de validade
  e validação do redirect URI.

## Checklist de hardening

- [ ] Defina `API_SECRET`, `JWT_SECRET` e `SECRETS_ENCRYPTION_KEY` fortes e únicos (o app se recusa a iniciar em produção com os padrões de dev).
- [ ] Faça backup de `SECRETS_ENCRYPTION_KEY` separadamente do banco de dados.
- [ ] Sirva tudo por HTTPS e ajuste as três URLs `PUBLIC_*` de acordo.
- [ ] Não exponha PostgreSQL, Redis, Evolution API nem WuzAPI na internet.
- [ ] Crie o primeiro administrador com uma senha forte; não mantenha os dados de demonstração do seed em produção.
- [ ] Restrinja o painel a redes confiáveis, se possível (`LOGIN_IP_ALLOWLIST` apenas *isenta* IPs da limitação).
- [ ] Dê aos assistentes conectados por MCP o usuário de menor privilégio (MEMBER).
- [ ] Monitore o `/health` e o webhook de ban (`BAN_WEBHOOK_URL`).

## Relatando vulnerabilidades

Veja [SECURITY.md](../SECURITY.md).
