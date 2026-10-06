# Cursor

Status: **Verificado** na documentação oficial em 2026-10-06 ([Cursor: MCP](https://cursor.com/docs/context/mcp)). O contorno descrito para a falta de DCR **não foi testado**.

## O ponto crítico

A documentação oficial diz que o Cursor aceita servidores remotos por **SSE e Streamable HTTP**, com OAuth, mas que **Dynamic Client Registration não é suportado**: é preciso informar um `CLIENT_ID` estático no bloco `auth`. Este servidor só registra clientes por DCR, então a configuração simples (somente `url`) pode não completar o login.

## Configuração básica

Arquivo `.cursor/mcp.json` (projeto) ou `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "apienvios": {
      "url": "https://api.example.com/mcp"
    }
  }
}
```

## Contorno: registrar o cliente à mão

A documentação do Cursor informa o redirect estático do desktop: `http://localhost:8787/callback`. Este servidor aceita registrar um cliente com esse redirect. Registre uma vez:

```bash
curl -sS -X POST https://api.example.com/mcp/oauth/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"Cursor","redirect_uris":["http://localhost:8787/callback"]}'
```

A resposta traz o `client_id`. Use-o no bloco `auth` da configuração:

```json
{
  "mcpServers": {
    "apienvios": {
      "url": "https://api.example.com/mcp",
      "auth": {
        "CLIENT_ID": "<client_id da resposta>"
      }
    }
  }
}
```

Pontos não confirmados: a documentação do Cursor mostra `CLIENT_SECRET` ao lado de `CLIENT_ID`, e não diz se ele é opcional para clientes públicos. O cliente deste servidor é público e **não tem segredo**. Se o Cursor exigir o campo, esse contorno não funciona e a saída é a ponte [mcp-remote](mcp-remote.md).

O cliente registrado fica guardado por 180 dias; depois disso, registre de novo.

## Alternativa: mcp-remote

```json
{
  "mcpServers": {
    "apienvios": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://api.example.com/mcp"]
    }
  }
}
```

Detalhes em [mcp-remote.md](mcp-remote.md).

Veja também [troubleshooting.md](../troubleshooting.md).
