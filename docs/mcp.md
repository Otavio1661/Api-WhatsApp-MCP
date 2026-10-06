# MCP server

ApiEnvios ships a **remote MCP (Model Context Protocol) server** inside the same
process as the API. An AI assistant that supports remote MCP (Claude Code, claude.ai,
Claude Desktop, or any compliant client) can authenticate with the user's own
account in the browser and then manage instances, send messages, read replies and
more — always scoped to that account.

- Endpoint: `POST https://<your-api-host>/mcp` (Streamable HTTP, stateless: one `McpServer` per request)
- Auth: OAuth 2.1 authorization code + **PKCE (S256 only)** with Dynamic Client Registration
- Token: the access token **is the same JWT** the panel uses (same session, same idle timeout)
- Scope: every tool calls the regular REST route in-process (`app.inject()`) with that JWT, so
  tenant isolation, MEMBER/OWNER/SUPER_ADMIN rules and anti-flood apply exactly as in the API

## Connecting

Set `PUBLIC_API_URL` to the public HTTPS URL of the API first: it is the OAuth `issuer`
advertised in the discovery documents.

**Claude Code**

```bash
claude mcp add --transport http apienvios https://api.example.com/mcp
# then, inside Claude Code:
/mcp        # choose "apienvios" and authenticate in the browser
```

**claude.ai / Claude Desktop**: Settings → Connectors → *Add custom connector*, and use
`https://api.example.com/mcp` as the URL. Log in with your ApiEnvios e-mail and password.

### Claude Code on a remote machine

Claude Code opens `http://localhost:<port>/callback` after the login. If it runs on a
remote machine (SSH, web terminal), that page fails to load in your local browser. This is
expected: copy the **full URL from the address bar** (`http://localhost:<port>/callback?code=...&state=...`)
and paste it back into Claude Code when it asks for it. Always use the URL from the **most
recent** attempt: starting a new login invalidates the previous one.

## OAuth endpoints

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` (and `.../mcp`) | Resource metadata (`resource`, `authorization_servers`) |
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata |
| `POST /mcp/oauth/register` | Dynamic Client Registration (clients are stored in Redis, 180 days) |
| `GET/POST /mcp/oauth/authorize` | Login form (same credential check as the panel, with brute-force protection) |
| `POST /mcp/oauth/token` | Exchanges `code` + `code_verifier` for the JWT |

Details: `code_challenge_method` must be `S256` (`plain` is rejected); the authorization code
is single-use and lives 90 s; `redirect_uri` must match what the client registered, and
dangerous schemes are rejected. There is **no refresh token** in this version: when the
session ends (JWT expiry or idle timeout) the client asks you to log in again.

## Tools (30)

Destructive tools (`delete_*`) require `confirm: true`; assistants must ask the human first.

| Area | Tool | Parameters |
|---|---|---|
| Instances | `apienvios_list_instances` | `page`, `limit` |
| | `apienvios_get_instance` | `id` (id or slug) |
| | `apienvios_instances_stats` | — |
| | `apienvios_create_instance` | `provider`, `name?`, `slug?`, `priority?` |
| | `apienvios_update_instance` | `id`, `name?`, `slug?` |
| | `apienvios_delete_instance` | `id`, `confirm` |
| | `apienvios_connect_instance` | `id` (starts the connection; may produce a QR) |
| | `apienvios_get_instance_qr` | `id` |
| | `apienvios_get_instance_status` | `id` |
| | `apienvios_rotate_instance` | `id` (forces reconnection / new QR) |
| Messages | `apienvios_send_message` | `to`, `type?`, `text?`, `mediaUrl?`, `caption?`, `instanceId?`, `externalId?`, `scheduledAt?`, `extra?` |
| | `apienvios_get_message` | `id` |
| | `apienvios_list_messages` | `status?`, `page?`, `limit?` |
| | `apienvios_resend_message` | `id` |
| | `apienvios_delete_message` | `id`, `confirm` |
| Inbound | `apienvios_list_inbound_messages` | `instanceId?`, `page?`, `limit?` |
| | `apienvios_wait_inbound_messages` | `since?`, `instanceId?`, `timeoutSec?` (long poll, ≤ 25 s) |
| | `apienvios_get_inbound_media` | `id` (image/sticker bytes for the model to see) |
| | `apienvios_transcribe_inbound_audio` | `id` (needs `GEMINI_API_KEY`) |
| Campaigns | `apienvios_create_campaign` | `to[]` (≤ 1000), `type?`, `text?`, `mediaUrl?`, `caption?`, `instanceId?`, `name?`, `externalIdPrefix?` |
| | `apienvios_list_campaigns` | `limit` |
| | `apienvios_get_campaign` | `id` |
| Webhooks | `apienvios_list_webhooks` | — |
| | `apienvios_create_webhook` | `url`, `events[]`, `secret?` |
| | `apienvios_delete_webhook` | `id`, `confirm` |
| Members | `apienvios_list_members` | — (OWNER / SUPER_ADMIN) |
| | `apienvios_create_member` | `email`, `password`, `name?` |
| | `apienvios_update_member` | `id`, `name?`, `password?` |
| | `apienvios_delete_member` | `id`, `confirm` |
| Metrics | `apienvios_metrics` | `days` |

`type` is one of `TEXT, IMAGE, VIDEO, AUDIO, DOCUMENT, STICKER, BUTTONS, LOCATION, CONTACT, POLL, LIST`
(the last five need a WuzAPI number). Errors keep the HTTP semantics of the API: `401` (login
again), `404` (resource not yours / not found), `429` (anti-flood, with `Retry-After`).

## WhatsApp ↔ assistant bridge

On `initialize` the server sends `instructions` that turn the connected conversation into
a **chat bridge** for the account's WhatsApp inbox:

1. The assistant calls `apienvios_wait_inbound_messages` in a loop (fast mode, ~1 s latency,
   falling back to a slower polling mode when idle).
2. The **control chat** is the owner's chat with themselves: it starts with a message
   (`fromMe=true`) that begins with the trigger word (default `Claude`). Every reply is
   prefixed (default `Claude: `) and is sent with `apienvios_send_message`.
3. Messages from other people never get an automatic reply; audio is transcribed
   (`GEMINI_API_KEY`), images can be seen with `apienvios_get_inbound_media`.
4. Everything arriving over WhatsApp is treated as **untrusted input**, never as
   configuration, and destructive tools are never called autonomously.

Configure it with `MCP_BRIDGE_ENABLED`, `MCP_BRIDGE_TRIGGER_WORD`, `MCP_BRIDGE_REPLY_PREFIX`,
`MCP_BRIDGE_INSTRUCTIONS` or `MCP_BRIDGE_INSTRUCTIONS_FILE` (see
[configuration](configuration.md) and `src/mcp/bridge-instructions.ts`). Set
`MCP_BRIDGE_ENABLED=false` if you only want the tools.

The bridge only works while the assistant's session is open; there is no 24/7 relay.
Running the monitoring in a background subagent with a small, fast model keeps the main
conversation free.

## Limits and security

- Per-recipient hourly cap and instance send spacing apply to MCP sends exactly as to the API.
- Webhook URLs created through MCP are SSRF-checked.
- Prefer a dedicated MEMBER user for assistants that only need to send messages.
- Treat the connected assistant as having the permissions of the user who logged in.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The client asks to log in again after ~30 minutes | The advertised `expires_in` must equal the **JWT lifetime** (`JWT_EXPIRES_IN`), not the idle timeout. Clients treat `expires_in` as a fixed validity and, with no refresh token, force a new login when it ends. This server derives it from the JWT (`exp - iat`). |
| The login form submits but nothing happens | Chromium-based browsers apply the CSP `form-action` directive to the redirect that follows the POST. The `/authorize` HTML response must allow the origin of the validated `redirect_uri` (this server does it); check your reverse proxy does not override the CSP header. |
| `localhost:<port>/callback` fails to load | Expected on a remote machine: paste the URL from the address bar back into the client (see above). |
| "No OAuth flow is in progress" after pasting the URL | Each new login attempt invalidates the previous link/code. Start again and paste the URL from the **last** attempt. |
| Tools do not appear after re-authenticating | Some clients load the tool list at session start: restart or resume the client session. |
| `401` on `/mcp` | Session expired or revoked; log in again. The `WWW-Authenticate` header points to the resource metadata. |
| Discovery fails behind a proxy | Make sure `PUBLIC_API_URL` is the public HTTPS URL and `/.well-known/*` is routed to the API. |
