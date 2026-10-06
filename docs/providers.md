# Provedores

O ApiEnvios conversa com o WhatsApp por meio de provedores plugáveis. Cada número de uma
instância é uma sessão real em um provedor. O fallback entre provedores é **opcional**, por
conta (`ApiClient.fallbackEnabled`).

| Provedor | Enum | Suporta | Configuração |
|---|---|---|---|
| [Evolution API](https://github.com/EvolutionAPI/evolution-api) | `EVOLUTION` | texto, mídia, figurinhas | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` |
| [WuzAPI](https://github.com/asternic/wuzapi) | `WUZAPI` | texto, mídia, **botões, localização, contato, enquetes, listas** | `WUZAPI_URL`, `WUZAPI_ADMIN_TOKEN` |
| WhatsApp Cloud API (oficial) | `CLOUD_API` | texto, mídia; pago | `WA_CLOUD_TOKEN`, `WA_CLOUD_PHONE_NUMBER_ID` |

Regras do roteador:

- Só números em estado `CONNECTED` recebem envios; números banidos são ignorados e rotacionados.
- Conteúdos que exigem tipos ricos (`BUTTONS`, `LOCATION`, `CONTACT`, `POLL`, `LIST`) são
  roteados para um número WuzAPI; provedores que não conseguem enviá-los falham de forma
  explícita em vez de degradar para texto.
- Números brasileiros: a ambiguidade do 9º dígito é resolvida com o endpoint de "checar número"
  do provedor antes do envio (veja `src/utils/jid-brasil.ts`).
- As mensagens recebidas chegam por webhooks do provedor, registrados automaticamente quando
  uma instância é conectada (o webhook carrega um segredo por instância).

O compose de exemplo pode subir a Evolution API e o WuzAPI com `--profile evolution` /
`--profile wuzapi` para avaliação. Para produção, siga a documentação de cada projeto
(banco, volumes, chaves de autenticação).

> O WhatsApp pode banir números que automatizam mensagens. Respeite os termos do WhatsApp,
> aqueça números novos, mantenha os limites anti-flood e envie mensagens apenas a quem
> consentiu em recebê-las.
