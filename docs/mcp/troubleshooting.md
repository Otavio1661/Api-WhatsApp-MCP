# Solução de problemas do MCP

## Login e autorização

| Sintoma | Causa e solução |
|---|---|
| O cliente pede novo login depois de cerca de 30 minutos, mesmo com uso contínuo | O `expires_in` anunciado precisa ser a **vida real do JWT** (`JWT_EXPIRES_IN`), não o tempo de inatividade. Clientes tratam `expires_in` como validade fixa e, sem `refresh_token`, exigem novo login quando ele acaba. Este servidor calcula `expires_in` como `exp - iat` do JWT. Se você alterou esse trecho, restaure o cálculo |
| O formulário de login é enviado, mas a página fica parada | Navegadores baseados em Chromium aplicam o `form-action` da CSP também ao **redirecionamento** que vem depois do POST. A resposta HTML do `/authorize` precisa liberar a origem do `redirect_uri` já validado (o servidor faz isso). Verifique se o seu proxy reverso não sobrescreve o cabeçalho `Content-Security-Policy`. No console do navegador, procure "Refused to send form data" |
| `http://localhost:<porta>/callback` não carrega | Esperado quando o cliente roda em máquina remota. Copie a URL **completa** da barra de endereço e cole no cliente (veja [clients/claude-code.md](clients/claude-code.md)) |
| "No OAuth flow is in progress" ao colar a URL | Cada novo login invalida o link e o código anteriores. Refaça o login e cole a URL da **última** tentativa, sem abrir outro login no meio |
| `Sessão de autorização expirada. Tente conectar novamente` | Os parâmetros do `/authorize` vivem 30 minutos e o formulário só vale uma vez. Recomece pela tela de conexão do cliente |
| `Parâmetros OAuth inválidos ou ausentes` (400) | O cliente não enviou `code_challenge_method=S256`, ou o `code_challenge` tem tamanho fora de 43 a 128, ou o `redirect_uri` não é `https://` nem `http://localhost` |
| `Client não registrado ou redirect_uri não corresponde` (400) | O cliente guardou um `client_id` que o servidor não conhece mais (Redis esvaziado ou registro com mais de 180 dias). Remova o servidor do cliente e adicione de novo para registrar outra vez |
| `invalid_grant` no `/token` | Mesma resposta para qualquer falha: código expirado (90 s), já usado, `client_id` ou `redirect_uri` diferentes dos da autorização, ou `code_verifier` que não confere. Refaça o login |
| `Muitas tentativas. Tente novamente em N min.` (429 no login) | Proteção contra força bruta: 5 falhas por 15 min por IP + conta, 20 por IP, 20 por dispositivo. Espere ou, em ambiente de teste, ajuste `LOGIN_*` (veja [../configuration.md](../configuration.md)) |
| `Credenciais inválidas.` | E-mail ou senha incorretos. O login MCP usa a mesma verificação do painel |

## Depois de conectado

| Sintoma | Causa e solução |
|---|---|
| `401 Sessão expirada. Faça login novamente.` | Passou mais que `SESSION_IDLE_TIMEOUT_MIN` sem nenhuma chamada, ou houve logout. Refaça o login (o `WWW-Authenticate` aponta para os metadados) |
| `401 Token inválido ou expirado` | JWT adulterado, expirado, ou `JWT_SECRET` mudou. Refaça o login |
| `401 Usuário ou conta inválidos/inativos` | O usuário foi removido ou a conta foi desativada |
| As tools não aparecem depois do `/mcp` mostrar "Authentication successful" | Alguns clientes só carregam a lista de tools no início da sessão. Reinicie ou retome a sessão do cliente (no Claude Code, `claude --continue`). Observação de prática, não de documentação oficial |
| `404` em uma instância que existe | Um MEMBER só enxerga as instâncias das quais é dono. Peça ao OWNER para atribuir a instância |
| `403` nas tools de membros | Exigem papel OWNER ou SUPER_ADMIN |
| `429 Rate limit excedido para este cliente` | Teto de requisições por minuto (`DEFAULT_RATE_LIMIT`, balde por IP). Reduza o ritmo do assistente. Atrás de proxy, confira se o IP real do cliente chega ao app |
| `429` ao enviar mensagem, com `Retry-After` | Limite de envios ao mesmo destinatário por hora (padrão 10 por conta). Espere o tempo indicado |
| `GET /mcp` devolve 404 | Esperado: o endpoint é sem estado e só aceita `POST` |
| Falha de descoberta atrás de proxy | Confirme que `PUBLIC_API_URL` é a URL HTTPS pública e que `/.well-known/*`, `/mcp` e `/mcp/oauth/*` chegam ao app. Teste: `curl https://api.example.com/.well-known/oauth-authorization-server` |

## Teste de ponta a ponta sem cliente

```bash
# 1. Sem token: deve responder 401 com o cabeçalho WWW-Authenticate
curl -i -X POST https://api.example.com/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"teste","version":"0"}}}'

# 2. Metadados de descoberta
curl -s https://api.example.com/.well-known/oauth-protected-resource/mcp
curl -s https://api.example.com/.well-known/oauth-authorization-server
```

Se o item 1 não trouxer `WWW-Authenticate: Bearer resource_metadata=...`, o proxy está removendo o cabeçalho.

## Problemas por cliente

Cada guia em [clients/](connect.md) tem os pontos específicos do cliente. Em resumo:

- **Claude Code:** máquina remota, porta de callback e retomada da sessão ([claude-code.md](clients/claude-code.md)).
- **claude.ai:** o servidor precisa ser público; escolha a opção de registro automático se a recomendada falhar ([claude-ai-desktop.md](clients/claude-ai-desktop.md)).
- **Cursor:** não faz DCR; use o cliente registrado à mão ou o `mcp-remote` ([cursor.md](clients/cursor.md)).
- **Gemini CLI:** exige navegador local ([gemini-cli.md](clients/gemini-cli.md)).
- **Clientes sem OAuth:** use o [mcp-remote](clients/mcp-remote.md).
