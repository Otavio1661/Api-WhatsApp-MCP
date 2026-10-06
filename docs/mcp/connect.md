# Conectar um cliente de IA ao MCP

Este guia mostra como conectar o servidor MCP do Api-WhatsApp-MCP a cada cliente. Antes de começar, leia [overview.md](overview.md) se quiser entender o fluxo de autenticação.

Em todos os exemplos, troque `https://api.example.com/mcp` pela URL pública do seu servidor (o valor de `PUBLIC_API_URL` mais `/mcp`).

## Pré-requisitos

1. O servidor precisa estar acessível por **HTTPS** na URL pública, com `PUBLIC_API_URL` apontando para ela e as rotas `/.well-known/oauth-*` e `/mcp*` encaminhadas ao app (veja [self-hosting.md](../self-hosting.md)).
2. Você precisa de um usuário no ApiEnvios (e-mail e senha). Para um assistente que só envia mensagens, prefira um usuário **MEMBER**, dono apenas das instâncias necessárias.
3. O endpoint `/mcp` só aceita o **JWT emitido pelo login OAuth** (ou pelo login do painel). Uma chave de API de conta não funciona nele.

## O que este servidor exige do cliente

| Requisito | Detalhe |
|---|---|
| Transporte | Streamable HTTP. Só `POST /mcp` (sem estado) |
| Autenticação | OAuth 2.1 com PKCE S256 |
| Registro do cliente | **Dynamic Client Registration** (`POST /mcp/oauth/register`). O servidor **não** suporta Client ID Metadata Documents nem registro prévio por painel |
| Redirect | `https://...` ou `http://localhost` / `http://127.0.0.1` |
| Token | Bearer, sem `refresh_token` (ao fim da sessão, novo login) |

Clientes que não fazem Dynamic Client Registration precisam de um client_id registrado manualmente ou da ponte `mcp-remote`. Veja cada guia.

## Tabela de compatibilidade

Status de verificação: **Verificado** significa que a página oficial do cliente foi lida em **2026-10-06** e a configuração abaixo vem dela. **Parcial** significa que só parte foi confirmada. **Não confirmado** significa que a documentação oficial consultada não cobre o ponto, e o guia diz o que falta testar. Nenhum cliente da lista foi testado de ponta a ponta contra este repositório aberto nesta rodada de documentação; o mantenedor já usou Claude Code e o conector do claude.ai contra o sistema original.

| Cliente | HTTP remoto | OAuth com DCR | Status | Guia |
|---|---|---|---|---|
| Claude Code | sim | sim (fluxo `/mcp`) | Verificado | [claude-code.md](clients/claude-code.md) |
| claude.ai, Claude Desktop | sim (conector personalizado) | sim (opção de registro automático) | Verificado (UI e requisitos) | [claude-ai-desktop.md](clients/claude-ai-desktop.md) |
| OpenAI Codex (CLI e extensão) | sim | sim (`--oauth-client-registration dcr`) | Verificado | [codex.md](clients/codex.md) |
| ChatGPT (modo desenvolvedor) | sim (HTTPS público) | indicado em fontes secundárias | Parcial | [chatgpt.md](clients/chatgpt.md) |
| Cursor | sim | **não** (a doc diz que DCR não é suportado) | Verificado, com contorno não testado | [cursor.md](clients/cursor.md) |
| VS Code (GitHub Copilot) | sim | não detalhado na doc consultada | Parcial | [vscode.md](clients/vscode.md) |
| Windsurf (docs atuais: Devin Desktop) | sim | sim (a doc cita OAuth) | Verificado | [windsurf.md](clients/windsurf.md) |
| Gemini CLI | sim (`httpUrl`) | sim, exige navegador local | Verificado | [gemini-cli.md](clients/gemini-cli.md) |
| Cline | sim (`streamableHttp`) | a doc não menciona OAuth | Parcial | [cline.md](clients/cline.md) |
| Zed | sim | sim | Verificado | [zed.md](clients/zed.md) |
| Continue | sim (`streamable-http`) | a doc não menciona OAuth | Parcial | [continue.md](clients/continue.md) |
| Qualquer cliente só com stdio | via `mcp-remote` | sim (navegador local) | Verificado (README do projeto) | [mcp-remote.md](clients/mcp-remote.md) |

## Escolha rápida

- Quer o caminho mais direto, na linha de comando: [Claude Code](clients/claude-code.md) ou [Codex](clients/codex.md).
- Prefere interface gráfica: [claude.ai e Claude Desktop](clients/claude-ai-desktop.md).
- Seu cliente não faz DCR ou só fala stdio: [mcp-remote](clients/mcp-remote.md).
- Servidor numa máquina remota sem navegador: veja a seção "Máquina remota" em cada guia e em [troubleshooting.md](troubleshooting.md).

## Depois de conectar

1. Confira as tools: peça ao assistente "liste as instâncias" (`apienvios_list_instances`).
2. Se você também quer a ponte de WhatsApp (o assistente respondendo mensagens), veja a seção "Ponte WhatsApp" em [overview.md](overview.md).
3. Exemplos de pedidos: [examples.md](examples.md).
4. Se as tools não aparecerem logo depois do login, veja [troubleshooting.md](troubleshooting.md).
