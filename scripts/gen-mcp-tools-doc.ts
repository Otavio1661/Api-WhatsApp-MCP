// scripts/gen-mcp-tools-doc.ts
// Generates docs/mcp-tools.md from the real tool definitions in src/mcp/tools/*.
//
//   npm run docs:mcp-tools          -> rewrites docs/mcp-tools.md
//   npm run docs:mcp-tools:check    -> exits 1 if the file is out of date (use in CI)
//
// Names, descriptions and parameters come from the zod shapes that are registered
// on the MCP server. The REST route behind each tool is read from the tool source
// (the `method:` / `url:` of its callApi). Nothing here needs a database or Redis.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { registerMessagesTools } from '../src/mcp/tools/messages.tools'
import { registerInstancesTools } from '../src/mcp/tools/instances.tools'
import { registerCampaignsTools } from '../src/mcp/tools/campaigns.tools'
import { registerWebhooksTools } from '../src/mcp/tools/webhooks.tools'
import { registerMetricsTools } from '../src/mcp/tools/metrics.tools'
import { registerAccountTools } from '../src/mcp/tools/account.tools'

type Shape = Record<string, z.ZodTypeAny>
interface CapturedTool {
  name: string
  description: string
  shape: Shape
  group: string
  file: string
}

const GROUPS: Array<{ id: string; title: string; file: string; register: (s: any, c: any) => void; guard: string }> = [
  { id: 'messages', title: 'Mensagens enviadas e recebidas', file: 'messages.tools.ts', register: registerMessagesTools, guard: 'authManage' },
  { id: 'instances', title: 'Instâncias (números de WhatsApp)', file: 'instances.tools.ts', register: registerInstancesTools, guard: 'authManage' },
  { id: 'campaigns', title: 'Campanhas (envio em lote)', file: 'campaigns.tools.ts', register: registerCampaignsTools, guard: 'authManage' },
  { id: 'webhooks', title: 'Webhooks', file: 'webhooks.tools.ts', register: registerWebhooksTools, guard: 'authManage' },
  { id: 'metrics', title: 'Métricas', file: 'metrics.tools.ts', register: registerMetricsTools, guard: 'authManage' },
  { id: 'account', title: 'Membros da conta', file: 'account.tools.ts', register: registerAccountTools, guard: 'authJwt + requireOwner' },
]

function capture(): CapturedTool[] {
  const out: CapturedTool[] = []
  for (const g of GROUPS) {
    const fake = {
      tool: (name: string, description: string, shape: Shape) => {
        out.push({ name, description, shape, group: g.id, file: g.file })
      },
    }
    g.register(fake, { app: {}, token: '' })
  }
  return out
}

// ── zod v3 introspection ─────────────────────────────────────
interface ParamInfo {
  name: string
  type: string
  required: boolean
  defaultValue?: string
  description?: string
}

function unwrap(schema: any): { inner: any; optional: boolean; defaultValue?: unknown; description?: string } {
  let cur = schema
  let optional = false
  let defaultValue: unknown
  let description: string | undefined = schema.description
  for (let i = 0; i < 6; i++) {
    const t = cur?._def?.typeName
    if (t === 'ZodOptional') {
      optional = true
      cur = cur._def.innerType
    } else if (t === 'ZodDefault') {
      optional = true
      defaultValue = cur._def.defaultValue()
      cur = cur._def.innerType
    } else if (t === 'ZodNullable') {
      cur = cur._def.innerType
    } else break
    description = description ?? cur.description
  }
  return { inner: cur, optional, defaultValue, description }
}

function typeLabel(inner: any): string {
  const t = inner?._def?.typeName
  switch (t) {
    case 'ZodString': {
      const checks: any[] = inner._def.checks ?? []
      const extra: string[] = []
      for (const c of checks) {
        if (c.kind === 'min') extra.push(`min ${c.value}`)
        else if (c.kind === 'max') extra.push(`max ${c.value}`)
        else if (c.kind === 'email') extra.push('e-mail')
        else if (c.kind === 'url') extra.push('URL')
        else if (c.kind === 'datetime') extra.push('ISO 8601')
      }
      return extra.length ? `string (${extra.join(', ')})` : 'string'
    }
    case 'ZodNumber': {
      const checks: any[] = inner._def.checks ?? []
      const extra: string[] = []
      let isInt = false
      for (const c of checks) {
        if (c.kind === 'int') isInt = true
        else if (c.kind === 'min') extra.push(`min ${c.value}`)
        else if (c.kind === 'max') extra.push(`max ${c.value}`)
      }
      const base = isInt ? 'inteiro' : 'número'
      return extra.length ? `${base} (${extra.join(', ')})` : base
    }
    case 'ZodBoolean':
      return 'boolean'
    case 'ZodLiteral':
      return `literal \`${JSON.stringify(inner._def.value)}\``
    case 'ZodEnum':
      return `enum: ${(inner._def.values as string[]).map((v) => `\`${v}\``).join(', ')}`
    case 'ZodArray': {
      const el = unwrap(inner._def.type).inner
      const min = inner._def.minLength?.value
      const max = inner._def.maxLength?.value
      const bounds = [min != null ? `min ${min}` : '', max != null ? `max ${max}` : ''].filter(Boolean).join(', ')
      return `lista de ${typeLabel(el)}${bounds ? ` (${bounds})` : ''}`
    }
    case 'ZodRecord':
    case 'ZodObject':
      return 'objeto'
    default:
      return String(t ?? 'desconhecido').replace(/^Zod/, '').toLowerCase()
  }
}

function params(shape: Shape): ParamInfo[] {
  return Object.entries(shape).map(([name, schema]) => {
    const u = unwrap(schema)
    return {
      name,
      type: typeLabel(u.inner),
      required: !u.optional,
      defaultValue: u.defaultValue === undefined ? undefined : JSON.stringify(u.defaultValue),
      description: u.description,
    }
  })
}

// ── REST route behind each tool, read from the source ────────
function routes(file: string): Record<string, { method: string; path: string }> {
  const src = readFileSync(join(__dirname, '..', 'src', 'mcp', 'tools', file), 'utf8')
  const blocks = src.split('defineTool(').slice(1)
  const map: Record<string, { method: string; path: string }> = {}
  for (const b of blocks) {
    const name = b.match(/'(apienvios_\w+)'/)?.[1]
    const method = b.match(/method:\s*'(GET|POST|PATCH|DELETE)'/)?.[1]
    const rawUrl = b.match(/url:\s*(`[^`]+`|'[^']+')/)?.[1]
    if (!name || !method || !rawUrl) continue
    const path = rawUrl
      .slice(1, -1)
      .replace(/\$\{encodeURIComponent\((\w+)\)\}/g, ':$1')
      .split('?')[0]
    map[name] = { method, path }
  }
  return map
}

// ── Markdown ─────────────────────────────────────────────────
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function render(): string {
  const tools = capture()
  const lines: string[] = []
  lines.push('# Referência das tools do MCP')
  lines.push('')
  lines.push('> Este arquivo é **gerado** a partir do código (`npm run docs:mcp-tools`). Não edite à mão: altere as definições em `src/mcp/tools/` e gere de novo. O CI pode rodar `npm run docs:mcp-tools:check` para detectar documentação desatualizada.')
  lines.push('')
  lines.push(`O servidor MCP expõe **${tools.length} tools**, todas com o prefixo \`apienvios_\`. Cada tool chama internamente a rota REST equivalente, com o mesmo JWT do login (mesmo escopo de conta, mesmas regras de papel, mesmo anti-flood). As descrições abaixo são exatamente as enviadas ao modelo (no código, em português).`)
  lines.push('')
  lines.push('Convenções:')
  lines.push('')
  lines.push('- Resposta de toda tool: um JSON em texto com `statusCode` e `body` da rota REST. Erros mantêm a semântica HTTP (por exemplo `401`, `403`, `404`, `429`). A única exceção é `apienvios_get_inbound_media`, que devolve a imagem quando a mídia é imagem ou figurinha.')
  lines.push('- Tools destrutivas exigem `confirm: true`. O assistente deve pedir confirmação ao humano antes de enviar `true`.')
  lines.push('- Papéis: um **MEMBER** só enxerga as instâncias das quais é dono; **OWNER** e **SUPER_ADMIN** enxergam a conta. As tools de membros exigem OWNER ou SUPER_ADMIN.')
  lines.push('')
  lines.push('## Resumo')
  lines.push('')
  lines.push('| Tool | Rota REST | Guarda | Destrutiva |')
  lines.push('|---|---|---|:---:|')
  for (const g of GROUPS) {
    const r = routes(g.file)
    for (const t of tools.filter((x) => x.group === g.id)) {
      const route = r[t.name]
      const destructive = 'confirm' in t.shape ? 'sim' : 'não'
      lines.push(`| \`${t.name}\` | ${route ? `\`${route.method} ${route.path}\`` : '—'} | \`${g.guard}\` | ${destructive} |`)
    }
  }
  lines.push('')
  for (const g of GROUPS) {
    lines.push(`## ${g.title}`)
    lines.push('')
    for (const t of tools.filter((x) => x.group === g.id)) {
      lines.push(`### \`${t.name}\``)
      lines.push('')
      lines.push(t.description)
      lines.push('')
      const ps = params(t.shape)
      if (ps.length === 0) {
        lines.push('Sem parâmetros.')
      } else {
        lines.push('| Parâmetro | Tipo | Obrigatório | Padrão | Descrição |')
        lines.push('|---|---|:---:|---|---|')
        for (const p of ps) {
          lines.push(
            `| \`${p.name}\` | ${cell(p.type)} | ${p.required ? 'sim' : 'não'} | ${p.defaultValue ? `\`${cell(p.defaultValue)}\`` : '—'} | ${cell(p.description ?? '')} |`,
          )
        }
      }
      lines.push('')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

const target = join(__dirname, '..', 'docs', 'mcp-tools.md')
const next = render()
if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (current !== next) {
    console.error('docs/mcp-tools.md está desatualizado. Rode: npm run docs:mcp-tools')
    process.exit(1)
  }
  console.log('docs/mcp-tools.md está atualizado.')
} else {
  writeFileSync(target, next)
  console.log(`docs/mcp-tools.md gerado (${next.split('\n').length} linhas).`)
}
