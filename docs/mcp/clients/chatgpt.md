# ChatGPT (modo desenvolvedor)

Status: **Parcial**. A página oficial do artigo de ajuda ([Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)) apareceu nos resultados de busca, mas a leitura direta foi bloqueada (HTTP 403) em 2026-10-06. O que está abaixo vem do resumo da busca da página oficial e de guias de terceiros, e **não foi validado contra este servidor**.

## O que se sabe

- Conectores MCP personalizados dependem do **modo desenvolvedor**, que é um recurso em beta e **varia por plano** (o resumo oficial cita planos Business e Enterprise/Edu para MCP completo, com leitura apenas em alguns planos). Confira no artigo oficial qual é o seu caso.
- O servidor precisa estar em uma **URL HTTPS pública**.
- Quando as tools escrevem ou alteram dados, a OpenAI espera OAuth 2.1 conforme a especificação de autorização do MCP, com PKCE e servidor de autorização descobrível. Este servidor segue esse desenho.
- O artigo oficial alerta para riscos de injeção de prompt ao conectar servidores: conecte apenas servidores em que você confia, e use um usuário MEMBER com poucas instâncias.

## Como tentar

1. Ative o modo desenvolvedor conforme o artigo oficial (o caminho exato na interface muda; confirme no artigo).
2. Crie um conector/app personalizado informando a URL `https://api.example.com/mcp` e escolha autenticação **OAuth**.
3. Faça login com e-mail e senha do ApiEnvios.

## O que não foi confirmado

- Se o ChatGPT consegue registrar o cliente por Dynamic Client Registration neste servidor, ou se exige outra forma de registro.
- Quais tools de escrita ficam disponíveis em cada plano.

Se o fluxo de OAuth do ChatGPT não funcionar, a alternativa é usar um cliente que funcione (por exemplo, [Claude Code](claude-code.md) ou [Codex](codex.md)). Se você validar o ChatGPT, contribua com a correção deste guia (veja [CONTRIBUTING.md](../../../CONTRIBUTING.md)).
