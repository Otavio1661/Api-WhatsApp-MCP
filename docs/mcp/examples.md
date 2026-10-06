# Exemplos de uso

Pedidos em linguagem natural que o assistente converte em chamadas das tools (veja [../mcp-tools.md](../mcp-tools.md)). Os números abaixo são fictícios.

## Instâncias

- "Liste as minhas instâncias e diga quais estão conectadas." (`apienvios_list_instances`, `apienvios_get_instance_status`)
- "Crie uma instância chamada Suporte usando o provedor Evolution e gere o QR code." (`apienvios_create_instance`, `apienvios_connect_instance`, `apienvios_get_instance_qr`)
- "Reconecte a instância suporte: ela parou de responder." (`apienvios_rotate_instance`)
- "Quantas instâncias eu tenho por status e por provedor?" (`apienvios_instances_stats`)

## Enviar mensagens

- "Envie 'Olá, seu pedido saiu para entrega' para 5544999990000 pela instância suporte." (`apienvios_send_message`)
- "Agende para amanhã às 9h, no horário de Brasília, um lembrete para 5544999990000." (`apienvios_send_message` com `scheduledAt` em ISO 8601)
- "Envie esta imagem com a legenda 'Cardápio de hoje': https://exemplo.com/cardapio.png" (`type: IMAGE`, `mediaUrl`, `caption`)
- "A mensagem abc123 falhou. Veja o motivo e tente de novo." (`apienvios_get_message`, `apienvios_resend_message`)
- "Liste as últimas mensagens com status FAILED." (`apienvios_list_messages`)

Botões, localização, contato, enquete e lista só funcionam com número WuzAPI (veja [../providers.md](../providers.md)).

## Ler respostas

- "Tem alguma mensagem nova recebida? Resuma." (`apienvios_list_inbound_messages`)
- "Fique aguardando a próxima mensagem do cliente e me avise." (`apienvios_wait_inbound_messages`, espera de até 20 s por chamada)
- "Veja a imagem que o cliente mandou na mensagem xyz." (`apienvios_get_inbound_media`)
- "Transcreva o áudio da mensagem xyz." (`apienvios_transcribe_inbound_audio`, precisa de `GEMINI_API_KEY`)

## Campanhas, webhooks, métricas e equipe

- "Dispare 'Promoção até sexta' para estes 50 números, com prefixo de idempotência `promo-out`." (`apienvios_create_campaign`, até 1000 destinatários; cada um respeita o anti-flood)
- "Como está o progresso da campanha tal?" (`apienvios_get_campaign`)
- "Cadastre um webhook em https://exemplo.com/hook para os eventos MESSAGE_FAILED e BAN_DETECTED." (`apienvios_create_webhook`)
- "Mostre as métricas dos últimos 30 dias." (`apienvios_metrics`, até 90 dias)
- "Crie um usuário MEMBER para ana@exemplo.com." (`apienvios_create_member`, exige OWNER ou SUPER_ADMIN)

## Ações destrutivas

Apagar instância, mensagem, webhook ou membro exige `confirm: true`. O assistente deve pedir sua confirmação antes:

> Você: "Apague o webhook wh_123."
> Assistente: "Isso remove o webhook wh_123 da conta. Confirma?"
> Você: "Confirmo."

Se o seu cliente permite, desabilite essas tools ou exija aprovação manual (veja [security.md](security.md)).

## Ponte WhatsApp

Com a ponte ativa (padrão), mande para você mesmo, no WhatsApp, uma mensagem que comece com a palavra de ativação (padrão `Claude`), por exemplo `Claude, você está aí?`. O assistente conectado responde na mesma conversa, com o prefixo `Claude: `. Veja [overview.md](overview.md).
