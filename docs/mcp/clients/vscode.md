# VS Code (GitHub Copilot)

Status: **Parcial**. Formato de arquivo e comandos **verificados** na documentação oficial em 2026-10-06 ([VS Code: MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)). O suporte a OAuth e a Dynamic Client Registration **não** aparecem no conteúdo consultado.

## Configuração

Arquivo `.vscode/mcp.json` no workspace (ou o arquivo do perfil de usuário, aberto pelo comando **MCP: Open User Configuration**). Atenção: o VS Code usa a chave `"servers"`, não `"mcpServers"`.

```json
{
  "servers": {
    "apienvios": {
      "type": "http",
      "url": "https://api.example.com/mcp"
    }
  }
}
```

Formatos portáteis (`.mcp.json` na raiz do workspace ou `~/.copilot/mcp-config.json`) usam `"mcpServers"`.

## Comandos

- **MCP: Add Server**: fluxo guiado.
- **MCP: List Servers**: lista, inicia, para e reautentica servidores.
- **MCP: Open User Configuration**: abre a configuração do perfil.

## Autenticação

A documentação consultada recomenda não gravar segredos no arquivo e usar variáveis de entrada (`inputs`). Este servidor usa OAuth: sem cabeçalho de autorização configurado, o esperado é que o VS Code abra o fluxo de login ao conectar. **Isso não foi confirmado.** Teste: adicione o servidor, inicie-o pela lista de servidores e veja se o navegador abre `.../mcp/oauth/authorize`. Se não abrir, use [mcp-remote](mcp-remote.md).

Veja também [troubleshooting.md](../troubleshooting.md).
