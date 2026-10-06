# OpenAI Codex (CLI e extensão para IDE)

Status: **Verificado** na documentação oficial em 2026-10-06 ([Codex: MCP](https://developers.openai.com/codex/mcp), que redireciona para `learn.chatgpt.com/docs/extend/mcp`). Formatos de configuração mudam com frequência: confirme a página oficial antes de automatizar.

## Conectar pela linha de comando

```bash
codex mcp add apienvios --url https://api.example.com/mcp
codex mcp login apienvios --oauth-client-registration dcr
```

O Codex escolhe sozinho entre dois modos de registro de cliente OAuth: Client ID Metadata Documents (CIMD), quando o servidor oferece, e Dynamic Client Registration (DCR). Este servidor oferece **somente DCR**, então use `--oauth-client-registration dcr` (ou deixe o Codex escolher; ele cai em DCR quando não há CIMD).

Outros comandos: `codex mcp list`, `codex mcp logout apienvios`, `codex mcp remove apienvios`, `codex mcp --help`.

## Conectar pelo arquivo de configuração

A configuração fica em `~/.codex/config.toml` (global) ou `.codex/config.toml` (por projeto, só em projetos confiáveis). O aplicativo do ChatGPT para desktop, a CLI e a extensão para IDE compartilham essa configuração.

```toml
[mcp_servers.apienvios]
url = "https://api.example.com/mcp"
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 60
```

Outras chaves documentadas para servidores HTTP: `bearer_token_env_var`, `http_headers`, `env_http_headers`, `enabled_tools` e `disabled_tools`. Esta última é útil para esconder tools destrutivas:

```toml
disabled_tools = ["apienvios_delete_instance", "apienvios_delete_message", "apienvios_delete_webhook", "apienvios_delete_member"]
```

Não use `bearer_token_env_var` com este servidor: o `/mcp` só aceita o JWT do login OAuth, que expira por inatividade.

## Extensão para IDE

Na extensão: engrenagem, **MCP servers**, **Add server**, escolha o transporte **Streamable HTTP**, informe a URL e use **Restart extension**. Servidores que precisam de login mostram o botão **Authenticate**.

## Callback do OAuth

A documentação lista `mcp_oauth_callback_port`, `mcp_oauth_callback_url` e o bloco `[mcp_servers.<nome>.oauth]` (`client_id`, `callback_url`, `callback_port`). A mesma página diz que callbacks estáveis exigem que o servidor de autorização informe `authorization_response_iss_parameter_supported: true`. **Este servidor não anuncia esse campo** (veja os metadados em `src/routes/mcp-metadata.route.ts`). Por isso, não configure `callback_url` estável; use o padrão do Codex (porta de loopback efêmera) ou apenas `callback_port` se precisar liberar uma porta. Esta conclusão combina a documentação do Codex com os metadados deste servidor e não foi testada.

## Máquina remota ou sem navegador

A página consultada não descreve o fluxo para máquina sem navegador. **Não confirmado.** Consulte `codex mcp login --help` e a documentação do Codex antes de depender disso em servidores remotos.

Veja também [troubleshooting.md](../troubleshooting.md).
