# Ponte mcp-remote (clientes só com stdio ou sem DCR)

Status: **Verificado** no README do projeto ([geelen/mcp-remote](https://github.com/geelen/mcp-remote)), lido em 2026-10-06. Ferramenta de terceiros: avalie antes de usar.

O `mcp-remote` é um programa local (stdio) que conversa com um servidor MCP remoto e cuida do OAuth. Serve para clientes que só suportam servidores locais ou que não conseguem registrar o cliente OAuth sozinhos.

## Configuração

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

Na primeira execução ele abre o navegador para o login e guarda as credenciais em `~/.mcp-auth`. Para limpar o estado e refazer o login: `rm -rf ~/.mcp-auth`.

## Opções úteis (segundo o README)

| Opção | Efeito |
|---|---|
| `--transport http-only` | Força Streamable HTTP (o padrão é `http-first`). Este servidor só oferece HTTP |
| `--header "Nome: valor"` | Adiciona cabeçalho. Não use para guardar o JWT deste servidor (expira por inatividade) |
| `--host` | Muda o host do callback do OAuth (padrão `localhost`) |
| número da porta, depois da URL | Fixa a porta do callback |
| `--static-oauth-client-info` | Informa um cliente OAuth pré-registrado (JSON ou `@arquivo`) |

Exemplo com porta fixa e transporte HTTP:

```json
{
  "args": ["-y", "mcp-remote", "https://api.example.com/mcp", "9696", "--transport", "http-only"]
}
```

## Máquina sem navegador

O README cita `--device-code` (fluxo de código no dispositivo) e `--client-credentials`. **Nenhum dos dois funciona com este servidor**: os metadados anunciam somente `grant_types_supported: ["authorization_code"]`. Em máquina sem navegador, use [Claude Code](claude-code.md) (que aceita colar a URL do callback) ou faça o login em uma máquina com navegador.

Veja também [troubleshooting.md](../troubleshooting.md).
