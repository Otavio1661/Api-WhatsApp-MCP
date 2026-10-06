# Continue

Status: **Parcial**. Formato **verificado** em 2026-10-06 ([Continue: MCP](https://docs.continue.dev/customize/deep-dives/mcp)); a página não cita cabeçalhos nem OAuth.

## Configuração

Um arquivo YAML em `.continue/mcpServers/` (por exemplo `.continue/mcpServers/apienvios.yaml`) ou dentro do `config.yaml`:

```yaml
mcpServers:
  - name: apienvios
    type: streamable-http
    url: https://api.example.com/mcp
```

## Autenticação

A documentação consultada não menciona OAuth, então **não está confirmado** que o Continue consiga o login OAuth deste servidor. A saída é a ponte [mcp-remote](mcp-remote.md), declarada como servidor local. Exemplo **não verificado** na documentação do Continue:

```yaml
mcpServers:
  - name: apienvios
    type: stdio
    command: npx
    args:
      - "-y"
      - mcp-remote
      - https://api.example.com/mcp
```

Confira o formato do bloco `stdio` no manual do Continue antes de usar.

Veja também [troubleshooting.md](../troubleshooting.md).
