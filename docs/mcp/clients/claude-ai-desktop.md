# claude.ai e Claude Desktop

Status: **Verificado** (interface, planos e requisitos de rede) no artigo oficial [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), lido em 2026-10-06. O artigo não detalha o fluxo técnico (URL de callback, transporte); isso vem da prática.

## Conectar

1. Abra **Customize > Connectors** e escolha **Add custom connector**.
2. Informe um nome e a URL do servidor: `https://api.example.com/mcp`.
3. Em autenticação, o artigo descreve três opções: **Use Claude's published identity (Recommended)**, **Register automatically** e **Use your own OAuth client**. Este servidor registra clientes por **Dynamic Client Registration**, então a opção de **registro automático** é a que corresponde ao que ele oferece. Se a opção recomendada falhar, troque para o registro automático. Qual opção funciona exatamente com este servidor não foi validado nesta rodada.
4. Faça login com e-mail e senha do ApiEnvios quando o navegador abrir.

Conectores criados no claude.ai valem também no Claude Desktop, no Cowork e nos aplicativos móveis, porque a conexão sai da infraestrutura da Anthropic, não do seu computador. Os planos Free, Pro, Max, Team e Enterprise têm conectores personalizados, segundo o artigo (nomes e limites de plano mudam; confira o artigo).

## Requisito de rede

O artigo é explícito: o servidor MCP precisa ser acessível pela **internet pública**, a partir dos IPs da Anthropic. Um servidor em rede privada não conecta, mesmo que você consiga acessá-lo do seu computador. Isso vale para este servidor: ele precisa de HTTPS público (veja [self-hosting.md](../../self-hosting.md)).

## Observação sobre o tempo do login

O assistente de conexão do claude.ai tem várias etapas de verificação antes de mostrar o formulário de login, e depois você ainda digita e-mail e senha. Por isso este servidor guarda os parâmetros de autorização por **30 minutos** (e o código final por 90 segundos). Se aparecer "Sessão de autorização expirada", recomece pela tela de conexão.

## Claude Desktop sem conector (arquivo de configuração)

Para o Claude Desktop o caminho recomendado é o conector acima. Se o seu aplicativo só aceitar servidores locais por arquivo, use a ponte [mcp-remote](mcp-remote.md).

Veja também [troubleshooting.md](../troubleshooting.md).
