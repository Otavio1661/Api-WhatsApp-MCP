# Zed

Status: **Verificado** na documentação oficial em 2026-10-06 ([Zed: MCP](https://zed.dev/docs/ai/mcp)).

## Conectar

Pela interface: **Settings > AI > MCP Servers**, **Add Server**, **Add Remote Server**. Ou pelo `settings.json`, na chave `context_servers`:

```json
{
  "context_servers": {
    "apienvios": {
      "url": "https://api.example.com/mcp"
    }
  }
}
```

## Autenticação

A documentação diz que, quando um servidor remoto **não tem** cabeçalho `Authorization` configurado, o Zed pede que você se autentique pelo fluxo OAuth padrão do MCP. Portanto, **não** configure `headers` para este servidor: deixe só a `url` e faça o login quando o Zed pedir.

Pontos não confirmados: o registro do cliente por Dynamic Client Registration com este servidor. Se falhar, use [mcp-remote](mcp-remote.md).

Veja também [troubleshooting.md](../troubleshooting.md).
