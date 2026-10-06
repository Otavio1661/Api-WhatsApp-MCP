# Claude Code

Status: **Verificado** na documentação oficial em 2026-10-06 ([Claude Code: MCP](https://code.claude.com/docs/en/mcp)). Testado pelo mantenedor contra o sistema original.

## Conectar

```bash
claude mcp add --transport http apienvios https://api.example.com/mcp
```

Depois, dentro do Claude Code:

```text
/mcp
```

Escolha `apienvios` e autentique no navegador (e-mail e senha do ApiEnvios). Enquanto não autenticar, o servidor aparece como "Needs authentication".

Por linha de comando, também é possível:

```bash
claude mcp login apienvios            # abre o navegador
claude mcp login apienvios --no-browser   # imprime a URL de autorização
claude mcp logout apienvios           # apaga as credenciais
```

## Escopos e arquivos

| Escopo | Onde fica | Quando vale |
|---|---|---|
| `local` (padrão) | `~/.claude.json` | Só no projeto atual |
| `project` | `.mcp.json` na raiz do projeto | Compartilhado com a equipe (versionado) |
| `user` | `~/.claude.json` | Todos os seus projetos |

```bash
claude mcp add --transport http --scope user apienvios https://api.example.com/mcp
```

Formato do `.mcp.json` para um servidor HTTP:

```json
{
  "mcpServers": {
    "apienvios": {
      "type": "http",
      "url": "https://api.example.com/mcp"
    }
  }
}
```

Não coloque tokens nem senhas nesse arquivo. A autenticação deste servidor é por OAuth e fica guardada pelo próprio Claude Code. Servidores de projeto pedem aprovação antes de conectar.

Outros comandos úteis: `claude mcp list`, `claude mcp get apienvios`, `claude mcp remove apienvios` e `claude mcp add-json apienvios '{"type":"http","url":"https://api.example.com/mcp"}'`.

## Máquina remota (SSH, terminal web)

Quando o Claude Code roda em outra máquina, o navegador do seu computador não consegue abrir `http://localhost:<porta>/callback`, e a página dá erro de conexão. Isso é esperado. A documentação oficial manda colar a **URL completa da barra de endereço** (`http://localhost:<porta>/callback?code=...&state=...`) no campo de URL que o Claude Code mostra.

Cuidados:

- Use a URL da **tentativa mais recente**. Cada novo login invalida o anterior.
- Cole logo, o código de autorização vale 90 segundos.
- Se aparecer "No OAuth flow is in progress", comece o login de novo e cole a URL da última tentativa.

## Porta fixa do callback

Se você precisar de uma porta de callback fixa (por exemplo, para liberar no firewall):

```bash
claude mcp add --transport http --callback-port 8080 apienvios https://api.example.com/mcp
```

Este servidor aceita qualquer `http://localhost:<porta>/callback` no registro, então a porta fixa funciona. Você não precisa de `--client-id`: o cliente se registra sozinho por DCR.

## Depois do login: as tools não aparecem

Algumas versões só carregam a lista de tools no início da sessão. Se o `/mcp` mostrar "Authentication successful" e as tools `apienvios_*` não aparecerem, saia e retome a sessão (`claude --continue`). Esta observação vem da prática do mantenedor, não da documentação oficial.

Veja também [troubleshooting.md](../troubleshooting.md).
