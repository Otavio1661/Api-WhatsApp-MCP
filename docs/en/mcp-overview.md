# MCP server: short English summary

The full guides are written in Brazilian Portuguese under [docs/mcp/](../mcp/overview.md). This page summarizes them.

## What it is

Api-WhatsApp-MCP ships a **remote MCP server** inside the API process. An AI assistant that supports remote MCP authenticates in the browser with the user's own account and can then manage instances, send messages, read replies and read metrics, always scoped to that account.

| Item | Value |
|---|---|
| Endpoint | `POST https://<your-api-host>/mcp` |
| Transport | Streamable HTTP, **stateless** (a new `McpServer` per request) |
| Auth | OAuth 2.1 authorization code with **PKCE (S256 only)** and Dynamic Client Registration (public client) |
| Token | The panel's own JWT (same session and idle timeout) |
| Scope | Each tool calls the matching REST route in-process with the user's JWT: tenant isolation, roles (MEMBER / OWNER / SUPER_ADMIN) and anti-flood apply as in the API |
| Tools | 30, listed in [mcp-tools.md](../mcp-tools.md) (descriptions are in Portuguese, as in the code) |

Discovery: `GET /.well-known/oauth-protected-resource` (and `/mcp`), `GET /.well-known/oauth-authorization-server`. Unauthenticated calls to `/mcp` get `401` with `WWW-Authenticate: Bearer resource_metadata="..."`. Set `PUBLIC_API_URL` to your public HTTPS URL: it is the OAuth issuer.

## Sessions

`expires_in` is the JWT lifetime (`JWT_EXPIRES_IN`, default 7 days). The session also dies after `SESSION_IDLE_TIMEOUT_MIN` (default 30) minutes without any call, enforced in Redis with a sliding window. There is **no refresh token**: when the session ends, the client asks the user to log in again.

## Connecting a client

Use your public URL, for example `https://api.example.com/mcp`.

```bash
# Claude Code (then run /mcp inside it to authenticate)
claude mcp add --transport http apienvios https://api.example.com/mcp

# OpenAI Codex CLI
codex mcp add apienvios --url https://api.example.com/mcp
codex mcp login apienvios --oauth-client-registration dcr
```

This server supports **Dynamic Client Registration only** (no Client ID Metadata Documents). Clients that cannot register dynamically (for example Cursor, whose docs say DCR is unsupported) need a manually registered `client_id` or the `mcp-remote` bridge. Per-client guides, with the verification status of each (checked against the vendors' documentation on 2026-10-06), are in [docs/mcp/connect.md](../mcp/connect.md).

On a remote machine (SSH), the browser cannot open `http://localhost:<port>/callback`. Copy the full URL from the address bar and paste it into the client; use the URL of the most recent attempt.

## Security notes

- The MCP access token is a full session token of the user and is also accepted by the REST routes. Treat it like a password and give assistants a dedicated MEMBER user.
- Known differences from the current MCP authorization spec: no Client ID Metadata Documents, no audience-bound tokens, no `iss` in the authorization response, no refresh tokens, a single informational scope (`mcp`). Details in [docs/mcp/security.md](../mcp/security.md) (Portuguese).
- Destructive tools require `confirm: true`; do not auto-approve them in your client.
- Messages received over WhatsApp are untrusted input to the model (prompt injection). Set `MCP_BRIDGE_ENABLED=false` if you do not need the WhatsApp bridge.

## Troubleshooting

Common issues (re-login after ~30 minutes, login form that does nothing, callback on remote machines, tools not showing after login) are explained in [docs/mcp/troubleshooting.md](../mcp/troubleshooting.md) (Portuguese). The short version: `expires_in` must equal the JWT lifetime; the `/authorize` response must allow the redirect origin in the CSP `form-action`; and some clients only load tools at session start, so restart the session after authenticating.
