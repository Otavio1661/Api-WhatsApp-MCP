# Referência das tools do MCP

> Este arquivo é **gerado** a partir do código (`npm run docs:mcp-tools`). Não edite à mão: altere as definições em `src/mcp/tools/` e gere de novo. O CI pode rodar `npm run docs:mcp-tools:check` para detectar documentação desatualizada.

O servidor MCP expõe **30 tools**, todas com o prefixo `apienvios_`. Cada tool chama internamente a rota REST equivalente, com o mesmo JWT do login (mesmo escopo de conta, mesmas regras de papel, mesmo anti-flood). As descrições abaixo são exatamente as enviadas ao modelo (no código, em português).

Convenções:

- Resposta de toda tool: um JSON em texto com `statusCode` e `body` da rota REST. Erros mantêm a semântica HTTP (por exemplo `401`, `403`, `404`, `429`). A única exceção é `apienvios_get_inbound_media`, que devolve a imagem quando a mídia é imagem ou figurinha.
- Tools destrutivas exigem `confirm: true`. O assistente deve pedir confirmação ao humano antes de enviar `true`.
- Papéis: um **MEMBER** só enxerga as instâncias das quais é dono; **OWNER** e **SUPER_ADMIN** enxergam a conta. As tools de membros exigem OWNER ou SUPER_ADMIN.

## Resumo

| Tool | Rota REST | Guarda | Destrutiva |
|---|---|---|:---:|
| `apienvios_send_message` | `POST /v1/messages` | `authManage` | não |
| `apienvios_get_message` | `GET /v1/messages/:id` | `authManage` | não |
| `apienvios_list_messages` | `GET /v1/messages` | `authManage` | não |
| `apienvios_resend_message` | `POST /v1/messages/:id/resend` | `authManage` | não |
| `apienvios_delete_message` | `DELETE /v1/messages/:id` | `authManage` | sim |
| `apienvios_list_inbound_messages` | `GET /v1/inbound-messages` | `authManage` | não |
| `apienvios_wait_inbound_messages` | `GET /v1/inbound-messages/wait` | `authManage` | não |
| `apienvios_get_inbound_media` | `GET /v1/inbound-messages/:id/media` | `authManage` | não |
| `apienvios_transcribe_inbound_audio` | `POST /v1/inbound-messages/:id/transcribe` | `authManage` | não |
| `apienvios_list_instances` | `GET /v1/instances` | `authManage` | não |
| `apienvios_get_instance` | `GET /v1/instances/:id` | `authManage` | não |
| `apienvios_instances_stats` | `GET /v1/instances/stats` | `authManage` | não |
| `apienvios_create_instance` | `POST /v1/instances` | `authManage` | não |
| `apienvios_update_instance` | `PATCH /v1/instances/:id` | `authManage` | não |
| `apienvios_delete_instance` | `DELETE /v1/instances/:id` | `authManage` | sim |
| `apienvios_connect_instance` | `POST /v1/instances/:id/connect` | `authManage` | não |
| `apienvios_get_instance_qr` | `GET /v1/instances/:id/qr` | `authManage` | não |
| `apienvios_get_instance_status` | `GET /v1/instances/:id/status` | `authManage` | não |
| `apienvios_rotate_instance` | `POST /v1/instances/:id/rotate` | `authManage` | não |
| `apienvios_create_campaign` | `POST /v1/campaigns` | `authManage` | não |
| `apienvios_list_campaigns` | `GET /v1/campaigns` | `authManage` | não |
| `apienvios_get_campaign` | `GET /v1/campaigns/:id` | `authManage` | não |
| `apienvios_list_webhooks` | `GET /v1/webhooks` | `authManage` | não |
| `apienvios_create_webhook` | `POST /v1/webhooks` | `authManage` | não |
| `apienvios_delete_webhook` | `DELETE /v1/webhooks/:id` | `authManage` | sim |
| `apienvios_metrics` | `GET /v1/metrics` | `authManage` | não |
| `apienvios_list_members` | `GET /v1/account/users` | `authJwt + requireOwner` | não |
| `apienvios_create_member` | `POST /v1/account/users` | `authJwt + requireOwner` | não |
| `apienvios_update_member` | `PATCH /v1/account/users/:id` | `authJwt + requireOwner` | não |
| `apienvios_delete_member` | `DELETE /v1/account/users/:id` | `authJwt + requireOwner` | sim |

## Mensagens enviadas e recebidas

### `apienvios_send_message`

Envia uma mensagem de WhatsApp de verdade (ou agenda, se scheduledAt informado). Respeita o teto anti-flood por destinatário e a posse da instância — se estourar o limite, devolve 429; se a instância não pertencer ao usuário (MEMBER), devolve 404.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `to` | string (min 10, max 20) | sim | — | Telefone destino, com DDI (ex.: 5544999990000) |
| `type` | enum: `TEXT`, `IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`, `STICKER`, `BUTTONS`, `LOCATION`, `CONTACT`, `POLL`, `LIST` | não | `"TEXT"` |  |
| `text` | string | não | — | Texto (obrigatório se type=TEXT ou BUTTONS) |
| `mediaUrl` | string (URL) | não | — | URL da mídia (obrigatório pra IMAGE/VIDEO/AUDIO/DOCUMENT/STICKER) |
| `caption` | string | não | — |  |
| `instanceId` | string | não | — | ID ou slug da instância; se omitido, a conta escolhe automaticamente |
| `externalId` | string | não | — | ID pra idempotência — reenviar com o mesmo externalId não duplica |
| `scheduledAt` | string (ISO 8601) | não | — | ISO 8601 — se informado, agenda em vez de enviar imediatamente |
| `extra` | objeto | não | — | Campos extras exigidos por tipos especiais (buttons/location/contact/poll/list) — ver documentação da API |

### `apienvios_get_message`

Detalhe de uma mensagem (status, tentativas de envio) — escopado à conta/MEMBER autenticado.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |

### `apienvios_list_messages`

Lista mensagens da conta (ou só do MEMBER autenticado), com filtro opcional por status e paginação.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `status` | enum: `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `SCHEDULED`, `CANCELLED` | não | — |  |
| `page` | inteiro (min 1) | não | `1` |  |
| `limit` | inteiro (min 1, max 100) | não | `20` |  |

### `apienvios_resend_message`

Reenfileira uma mensagem que falhou (status FAILED) ou que ficou travada em SENDING sem job na fila.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |

### `apienvios_delete_message`

Remove uma mensagem do histórico (e tenta remover o job da fila, best-effort). Ação destrutiva — exige confirm:true (confirme com o usuário antes de chamar).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |
| `confirm` | literal `true` | sim | — | Precisa ser true — confirme com o usuário antes de chamar esta tool |

### `apienvios_list_inbound_messages`

Lista mensagens RECEBIDAS (cliente respondendo no WhatsApp) — polling, não é tempo real. Use pra checar se alguém te mandou algo desde a última checagem.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `instanceId` | string | não | — | Filtra por uma instância específica |
| `page` | inteiro (min 1) | não | `1` |  |
| `limit` | inteiro (min 1, max 100) | não | `20` |  |

### `apienvios_wait_inbound_messages`

Espera (long-poll, até ~20s) chegar mensagem RECEBIDA nova e devolve NA HORA que ela chega — resposta em ~1s, sem polling. Passe em `since` o `nextSince` da resposta anterior (na 1ª chamada omita). Se `timedOut` vier true e `data` vazio, nada chegou: chame de novo com o `nextSince` devolvido.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `since` | string | não | — | Cursor ISO 8601: só mensagens criadas depois disso. Use o nextSince da chamada anterior; omita na primeira. |
| `instanceId` | string | não | — | Filtra por uma instância específica |
| `timeoutSec` | inteiro (min 1, max 25) | não | `20` | Máximo de segundos que a chamada espera antes de devolver vazio |

### `apienvios_get_inbound_media`

Baixa a mídia de uma mensagem RECEBIDA (use o `id` e o `mediaType` vindos de list/wait). Imagem e figurinha voltam como imagem pra você enxergar. Áudio do próprio dono já vem transcrito em `text`; para áudio sem `text` use apienvios_transcribe_inbound_audio.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — | id da mensagem recebida (campo `id` do list/wait) |

### `apienvios_transcribe_inbound_audio`

Transcreve UM áudio recebido que veio sem `text` (áudio de outro número, não transcrito automaticamente). Use só para áudio de um chat que você está autorizado a responder. Devolve a transcrição.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — | id da mensagem de áudio recebida (campo `id` do list/wait) |

## Instâncias (números de WhatsApp)

### `apienvios_list_instances`

Lista as instâncias (números de WhatsApp) da conta — se MEMBER, só as próprias.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `page` | inteiro (min 1) | não | `1` |  |
| `limit` | inteiro (min 1, max 100) | não | `20` |  |

### `apienvios_get_instance`

Detalhe de uma instância (id ou slug).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |

### `apienvios_instances_stats`

Estatísticas agregadas das instâncias da conta (contagem por status/provider).

Sem parâmetros.

### `apienvios_create_instance`

Cria uma nova instância (número de WhatsApp) — respeita a cota maxInstances da conta.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `provider` | enum: `EVOLUTION`, `WUZAPI`, `CLOUD_API` | sim | — |  |
| `name` | string | não | — |  |
| `slug` | string | não | — |  |
| `priority` | inteiro (min 0) | não | `0` |  |

### `apienvios_update_instance`

Renomeia uma instância (name e/ou slug — ao menos um obrigatório).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |
| `name` | string (min 1) | não | — |  |
| `slug` | string | não | — |  |

### `apienvios_delete_instance`

Apaga uma instância (cascata: números, mensagens associadas). Ação destrutiva — exige confirm:true (confirme com o usuário antes de chamar).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |
| `confirm` | literal `true` | sim | — | Precisa ser true — confirme com o usuário antes de chamar esta tool |

### `apienvios_connect_instance`

Inicia a conexão de uma instância (gera QR code pra escanear, dependendo do provider).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |

### `apienvios_get_instance_qr`

QR code atual da instância (string, geralmente data-URL) pra parear o WhatsApp.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |

### `apienvios_get_instance_status`

Status de conexão atual da instância (sincroniza com o provider antes de responder).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |

### `apienvios_rotate_instance`

Força a rotação/reconexão de uma instância (novo QR, desconecta a sessão atual do provider).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |

## Campanhas (envio em lote)

### `apienvios_create_campaign`

Dispara uma mensagem em lote pra até 1000 destinatários. Reusa a mesma fila e anti-flood do envio individual — cada destinatário pode ficar RATE_LIMITED se estourar o teto.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `to` | lista de string (min 10, max 20) (min 1, max 1000) | sim | — |  |
| `type` | enum: `TEXT`, `IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT` | não | `"TEXT"` |  |
| `text` | string | não | — |  |
| `mediaUrl` | string (URL) | não | — |  |
| `caption` | string | não | — |  |
| `instanceId` | string | não | — |  |
| `name` | string (max 120) | não | — | Rótulo do lote, aparece no monitor |
| `externalIdPrefix` | string (max 80) | não | — | Prefixo pra idempotência por destino |

### `apienvios_list_campaigns`

Lista campanhas com progresso agregado (escopado ao MEMBER se aplicável).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `limit` | inteiro (min 1, max 50) | não | `20` |  |

### `apienvios_get_campaign`

Progresso detalhado de uma campanha (contagem por status: enviado/falho/na fila).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |

## Webhooks

### `apienvios_list_webhooks`

Lista os webhooks cadastrados na conta.

Sem parâmetros.

### `apienvios_create_webhook`

Cadastra um webhook. A URL é validada contra SSRF (rejeita IP privado/loopback/metadata da nuvem).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `url` | string (URL) | sim | — |  |
| `events` | lista de enum: `BAN_DETECTED`, `NUMBER_ROTATED`, `NUMBER_DISCONNECTED`, `MESSAGE_FAILED`, `MESSAGE_DELIVERED`, `MESSAGE_RECEIVED`, `PROVIDER_DOWN` (min 1) | sim | — |  |
| `secret` | string | não | — | Segredo pra assinar/autenticar a entrega (?ws=) |

### `apienvios_delete_webhook`

Remove um webhook da conta. Ação destrutiva — exige confirm:true (confirme com o usuário antes de chamar).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |
| `confirm` | literal `true` | sim | — | Precisa ser true — confirme com o usuário antes de chamar esta tool |

## Métricas

### `apienvios_metrics`

Métricas de envio da conta: totais, série diária, por instância/número.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `days` | inteiro (min 1, max 90) | não | `7` |  |

## Membros da conta

### `apienvios_list_members`

Lista os MEMBERs (usuários) da conta — exige ser OWNER ou SUPER_ADMIN.

Sem parâmetros.

### `apienvios_create_member`

Cria um MEMBER na própria conta (login local com e-mail e senha).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `email` | string (e-mail) | sim | — |  |
| `password` | string (min 8) | sim | — |  |
| `name` | string | não | — |  |

### `apienvios_update_member`

Atualiza nome e/ou senha de um MEMBER da própria conta.

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |
| `name` | string (min 1) | não | — |  |
| `password` | string (min 8) | não | — |  |

### `apienvios_delete_member`

Remove um MEMBER da própria conta. Ação destrutiva — exige confirm:true (confirme com o usuário antes de chamar).

| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |
|---|---|:---:|---|---|
| `id` | string | sim | — |  |
| `confirm` | literal `true` | sim | — | Precisa ser true — confirme com o usuário antes de chamar esta tool |
