# Gemini CLI

Status: **Verificado** na documentação oficial em 2026-10-06 ([Gemini CLI: MCP servers](https://geminicli.com/docs/tools/mcp-server/)).

## Conectar pela linha de comando

```bash
gemini mcp add --transport http apienvios https://api.example.com/mcp
```

Dentro do Gemini CLI, `/mcp` mostra os servidores, as tools e o estado da conexão, e `/mcp auth apienvios` conduz a autenticação OAuth.

## Conectar pelo arquivo

`~/.gemini/settings.json` (usuário) ou `.gemini/settings.json` (projeto). Para Streamable HTTP a chave é `httpUrl` (a chave `url` é para SSE):

```json
{
  "mcpServers": {
    "apienvios": {
      "httpUrl": "https://api.example.com/mcp",
      "timeout": 30000
    }
  }
}
```

## OAuth

A documentação diz que o Gemini CLI detecta a exigência de OAuth pela resposta 401 e faz o registro dinâmico quando o servidor suporta, o que combina com este servidor (401 com `WWW-Authenticate`, metadados `.well-known` e `POST /mcp/oauth/register`).

Limitação oficial: a autenticação exige que a **máquina local consiga abrir um navegador**. Ambientes sem navegador (SSH, contêiner) não completam o fluxo. Para esses casos não há contorno documentado; use outro cliente (por exemplo, [Claude Code](claude-code.md), que aceita colar a URL do callback).

Veja também [troubleshooting.md](../troubleshooting.md).
