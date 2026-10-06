// src/mcp/tool-helper.ts
// Wrapper fino sobre McpServer.tool() só pra isolar um workaround de tipos.
//
// @modelcontextprotocol/sdk@1.30.1 foi compilado contra zod v4 (seus tipos
// internos AnySchema/ZodTypeAny esperam o shape interno do v4). O resto do
// ApiEnvios inteiro usa zod v3 (^3.23.8, dezenas de schemas já em produção)
// -- zod v3 e v4 têm shapes estruturais DIFERENTES o suficiente pra isso
// travar o tsc com "Type instantiation is excessively deep and possibly
// infinite" mesmo com um shape de UM campo só (`{ to: z.string() }`).
// Confirmado: é 100% incompatibilidade de TIPOS ESTÁTICOS, não de
// comportamento em runtime -- o SDK só chama .parse()/.safeParse() no
// shape internamente, e um ZodObject de v3 responde a isso perfeitamente
// (é exatamente o que o mcp-apienvios local, que usa zod v4, faz por
// baixo dos panos também). Migrar o projeto inteiro pra zod v4 só por
// causa deste SDK seria desproporcional. Cast `as any` isolado aqui,
// numa função só, em vez de espalhado pelos 6 arquivos de tools.
import type { z, ZodRawShape } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

type ToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
}

export function defineTool<Shape extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: Shape,
  handler: (input: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>,
): void {
  server.tool(name, description, shape as any, handler as any)
}
