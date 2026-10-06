# Windsurf (Cascade)

Status: **Verificado** na documentação oficial em 2026-10-06. A página antiga (`docs.windsurf.com/windsurf/cascade/mcp`) redireciona para a documentação atual em `docs.devin.ai/desktop/cascade/mcp`, onde o produto aparece como **Devin Desktop**. Nomes e caminhos mudaram; confirme na página oficial.

## Configuração

Segundo a documentação atual, o arquivo é `~/.config/devin/mcp_config.json` no macOS e Linux (ou `$XDG_CONFIG_HOME/devin/mcp_config.json`) e `%APPDATA%\devin\mcp_config.json` no Windows. O caminho `~/.codeium/windsurf/mcp_config.json`, muito citado em guias antigos, **não aparece** na documentação atual. Para abrir o arquivo certo, use o painel do Cascade: menu de ações (`...`) no topo do painel, seção MCPs, **Open MCP config file**.

Para servidores HTTP a chave da URL é `serverUrl`:

```json
{
  "mcpServers": {
    "apienvios": {
      "serverUrl": "https://api.example.com/mcp"
    }
  }
}
```

A documentação diz que há suporte a três transportes (`stdio`, `Streamable HTTP` e `SSE`) e que o OAuth é suportado em cada um. Interpolação de variáveis: `${env:NOME}` e `${file:/caminho}`.

## Pontos não confirmados

- Se o registro do cliente por Dynamic Client Registration funciona com este servidor. Se o login não abrir ou falhar, use [mcp-remote](mcp-remote.md).

Veja também [troubleshooting.md](../troubleshooting.md).
