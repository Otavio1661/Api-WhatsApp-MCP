# Cline

Status: **Parcial**. Formato de configuração **verificado** em 2026-10-06 ([Cline: configuring MCP servers](https://docs.cline.bot/mcp/configuring-mcp-servers)). A página **não menciona OAuth**, só cabeçalhos (`headers`).

## Configuração

Arquivo `cline_mcp_settings.json`, em `~/.cline/data/settings/` (o caminho pode ser alterado pela variável `CLINE_MCP_SETTINGS_PATH`). Na extensão para IDE: ícone **MCP Servers**, aba **Configure**, botão **Configure MCP Servers**. Há também a aba **Remote Servers**, em que você informa nome, URL e o tipo de transporte.

```json
{
  "mcpServers": {
    "apienvios": {
      "type": "streamableHttp",
      "url": "https://api.example.com/mcp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Use `"type": "streamableHttp"`: sem o campo, a documentação diz que o padrão é o transporte legado SSE, que este servidor não oferece.

## Autenticação

Como a documentação não cita OAuth, **não está confirmado** que o Cline consiga fazer o login OAuth deste servidor. Duas saídas:

1. Use a ponte [mcp-remote](mcp-remote.md), que faz o OAuth no navegador e entrega ao Cline um servidor local por stdio.
2. Cabeçalho `Authorization: Bearer <JWT>` com um JWT obtido pelo login da API. É frágil: a sessão expira por inatividade (padrão 30 minutos) e o JWT não é renovado. Use só para testes.

Não deixe `autoApprove` liberar tools destrutivas (`apienvios_delete_*`).

Veja também [troubleshooting.md](../troubleshooting.md).
