# Segurança do MCP

Este documento descreve a superfície do servidor MCP, o que ele protege, as diferenças conhecidas em relação à especificação atual do MCP e as boas práticas de uso. O modelo de segurança geral do projeto está em [../security.md](../security.md). Para reportar vulnerabilidades, veja [../../SECURITY.md](../../SECURITY.md).

## Superfície exposta

| Endpoint | Autenticado | Observação |
|---|:---:|---|
| `GET /.well-known/oauth-*` | não | Metadados públicos de descoberta |
| `POST /mcp/oauth/register` | não | Dynamic Client Registration aberto (padrão do fluxo). Sujeito ao rate limit global por IP |
| `GET/POST /mcp/oauth/authorize` | não (é o login) | Proteção própria contra força bruta em 3 camadas; fora do rate limit global de propósito |
| `POST /mcp/oauth/token` | código de uso único + PKCE | Resposta de erro única (`invalid_grant`) para qualquer falha |
| `POST /mcp` | sim (JWT) | Todas as tools. 401 com `WWW-Authenticate` quando não autenticado |

## O que o servidor protege

- **PKCE S256 obrigatório.** `plain` é rejeitado.
- **Código de autorização** de uso único, válido por 90 segundos. É apagado ao ser lido, mesmo se o PKCE falhar.
- **Validação do `redirect_uri`:** só `https://` ou `http://localhost` / `127.0.0.1`, e precisa ser exatamente um dos registrados. Parâmetros inválidos retornam 400 sem redirecionar (sem open redirect).
- **Parâmetros de autorização fora do formulário.** O formulário carrega só uma chave opaca guardada no Redis, não `code_challenge` nem `redirect_uri` em campos ocultos.
- **CSP restrita.** O formulário de login permite no `form-action` apenas a origem do `redirect_uri` já validado.
- **Isolamento por conta.** Cada tool chama a rota REST com o JWT do usuário; o escopo (conta, MEMBER) é decidido pela rota, nunca pela camada MCP.
- **Tools destrutivas exigem `confirm: true`.**
- **Webhooks criados por MCP** passam pela validação contra SSRF (IPs privados, loopback e metadados de nuvem são rejeitados).

## O token do MCP é uma sessão completa

O `access_token` é o **mesmo JWT do painel**. Quem o possui tem as permissões do usuário que fez login, enquanto a sessão estiver viva, e o mesmo JWT também é aceito pelas rotas REST (`Authorization: Bearer`). Trate-o como uma senha de sessão:

- Não cole o JWT, nem a URL de callback com `code=...`, em chats públicos, issues ou logs.
- Sessões morrem por inatividade (`SESSION_IDLE_TIMEOUT_MIN`, padrão 30 minutos), por logout e ao excluir o usuário.
- Para derrubar **todas** as sessões de uma vez, troque `JWT_SECRET` e reinicie.

## Diferenças conhecidas em relação à especificação do MCP

Comparação feita com a especificação de autorização do MCP lida em 2026-10-06 (versão `2026-07-28`). A especificação evolui; confira a versão atual.

| Item da especificação | Este servidor |
|---|---|
| PKCE | Implementado (S256) |
| Protected Resource Metadata (RFC 9728) e `WWW-Authenticate` com `resource_metadata` | Implementado |
| Authorization Server Metadata (RFC 8414) | Implementado |
| Dynamic Client Registration (RFC 7591) | Implementado (a especificação o trata como legado, mantido por compatibilidade) |
| Client ID Metadata Documents (a especificação recomenda) | **Não implementado**. Clientes que só usam esse mecanismo não conseguem se registrar |
| Parâmetro `resource` (RFC 8707) | Aceito e guardado junto ao código, mas **o token não é amarrado a essa audiência**. O JWT não tem claim de audiência |
| Validação de audiência do token no recurso | **Não implementada**: o token é o JWT de sessão do painel |
| `iss` na resposta de autorização (RFC 9207) | **Não enviado** (e `authorization_response_iss_parameter_supported` não é anunciado) |
| Refresh token | **Não emitido**. Ao fim da sessão, novo login |
| Escopos | `scope: "mcp"` fixo, apenas informativo. Não há escopos granulares por tool; o controle é por papel do usuário |

Essas diferenças são limites desta versão (`0.1.0`), não segredos. Se o seu modelo de ameaça exige audiência amarrada ao token ou escopos por tool, trate como trabalho a fazer antes de expor o MCP a clientes que você não controla.

## Boas práticas

1. **HTTPS sempre**, com `PUBLIC_API_URL` correto. Não exponha o servidor em HTTP puro.
2. **Menor privilégio:** conecte o assistente com um usuário **MEMBER**, dono apenas das instâncias necessárias. Evite usar a conta OWNER ou SUPER_ADMIN para uso rotineiro de assistentes.
3. **Bloqueie tools destrutivas no cliente.** Muitos clientes permitem lista de tools desabilitadas ou aprovação manual (por exemplo, `disabled_tools` no [Codex](clients/codex.md)). Não use aprovação automática para `apienvios_delete_*`.
4. **Mensagens recebidas são entrada não confiável.** Um contato mal-intencionado pode escrever instruções no WhatsApp para enganar o modelo (injeção de prompt). O texto da ponte manda o assistente ignorar isso, mas é uma defesa em nível de modelo, não uma barreira técnica. A barreira real é o menor privilégio e a confirmação humana para ações destrutivas. Se você não precisa da ponte, defina `MCP_BRIDGE_ENABLED=false`.
5. **Sessão curta:** reduza `SESSION_IDLE_TIMEOUT_MIN` se o assistente ficar em máquinas compartilhadas.
6. **Proxy reverso correto:** repasse o IP real do cliente (o servidor só confia em `X-Forwarded-For` quando o salto imediato é uma faixa privada), senão o rate limit por IP junta todos os usuários.
7. **Revise as aprovações** que o cliente pede antes de rodar tools de escrita (envio em lote, criação de webhook, gestão de membros).

## O que não expor

- `JWT_SECRET`, `API_SECRET`, `SECRETS_ENCRYPTION_KEY`, `GEMINI_API_KEY`, senhas de banco e tokens de provedores.
- Arquivos de configuração de cliente com cabeçalhos de autorização, em repositórios (por exemplo, `.mcp.json` com `headers`). Neste servidor você nem precisa deles: o login é por OAuth.
- JWT de sessão, URLs de callback com `code=` e prints do terminal que os mostrem.
- Dados de outras contas: se uma tool devolver algo que não é da conta do usuário, é um bug de isolamento; reporte conforme [../../SECURITY.md](../../SECURITY.md).
