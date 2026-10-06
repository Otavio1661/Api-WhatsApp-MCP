# Política de segurança

## Versões suportadas

Somente a versão mais recente na `main` recebe correções de segurança.

## Relatando uma vulnerabilidade

Por favor, **não abra uma issue pública**. Use o relato privado de vulnerabilidades do GitHub
(aba *Security* → *Report a vulnerability*) neste repositório. Inclua:

- uma descrição do problema e do seu impacto,
- passos para reproduzir (ou uma prova de conceito),
- a versão / o commit afetado.

Você receberá uma confirmação assim que um mantenedor puder analisar o relato. Pedimos
divulgação coordenada: dê-nos um prazo razoável para corrigir o problema antes de publicá-lo.

## Escopo

Dentro do escopo: a API, o painel web, o servidor MCP/OAuth e a configuração Docker padrão.
Fora do escopo: vulnerabilidades em provedores de terceiros (Evolution API, WuzAPI, WhatsApp)
e problemas que exijam um administrador de servidor malicioso.

## Se você encontrar um segredo vazado

Se notar uma credencial, um token ou dados pessoais enviados por engano a este repositório,
relate de forma privada, do mesmo modo, para que possam ser rotacionados e removidos.
