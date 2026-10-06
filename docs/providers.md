# Providers

ApiEnvios talks to WhatsApp through pluggable providers. Each number of an instance is a
real session in one provider. Fallback between providers is **opt-in** per account
(`ApiClient.fallbackEnabled`).

| Provider | Enum | Supports | Configure |
|---|---|---|---|
| [Evolution API](https://github.com/EvolutionAPI/evolution-api) | `EVOLUTION` | text, media, stickers | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` |
| [WuzAPI](https://github.com/asternic/wuzapi) | `WUZAPI` | text, media, **buttons, location, contact, polls, lists** | `WUZAPI_URL`, `WUZAPI_ADMIN_TOKEN` |
| WhatsApp Cloud API (official) | `CLOUD_API` | text, media; paid | `WA_CLOUD_TOKEN`, `WA_CLOUD_PHONE_NUMBER_ID` |

Rules of the router:

- Only numbers in `CONNECTED` state receive sends; banned numbers are skipped and rotated.
- Payloads that need rich types (`BUTTONS`, `LOCATION`, `CONTACT`, `POLL`, `LIST`) are routed
  to a WuzAPI number; providers that cannot send them fail explicitly instead of degrading to text.
- Brazilian numbers: the 9th-digit ambiguity is resolved with the provider's "check number"
  endpoint before sending (see `src/utils/jid-brasil.ts`).
- Inbound messages arrive through provider webhooks registered automatically when an instance
  is connected (the webhook carries a per-instance secret).

The example compose file can start Evolution API and WuzAPI with `--profile evolution` /
`--profile wuzapi` for evaluation. Follow each project's own documentation for production
(database, volumes, authentication keys).

> WhatsApp can ban numbers that automate messaging. Respect WhatsApp's terms, warm up new
> numbers, keep the anti-flood limits and only message people who opted in.
