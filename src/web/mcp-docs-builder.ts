// src/web/mcp-docs-builder.ts
// Constrói o conteúdo de src/web/mcp-docs.generated.ts (CLI: scripts/gen-panel-mcp-docs.ts).
// Só roda em desenvolvimento/teste: o servidor nunca importa este arquivo (usa o
// resultado já gerado, via ./mcp-docs). `marked` é devDependency.
// O módulo gerado traz: a documentação do MCP renderizada em HTML
// para a página Docs do painel (/admin/docs), a partir dos MESMOS arquivos .md
// de docs/ — uma única fonte, sem cópia à mão.
//
// Segurança: o HTML sai de arquivos versionados no repositório, e mesmo assim o
// renderizador é restritivo: HTML cru do markdown é escapado (nunca interpretado),
// links só http(s) ou âncoras internas, imagens viram texto, e nada gera <script>
// nem atributos de evento. O único JS no resultado são os atributos Alpine do botão
// "Copiar", o mesmo padrão já usado em src/web/views/docs.eta.
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { Marked } from 'marked'

// URL pública de produção que aparece nos .md. No painel ela é trocada, em cada
// request, pelo PUBLIC_API_URL do ambiente (ver src/web/mcp-docs.ts).
const PROD_BASE = 'https://api.example.com'
export const API_BASE_PLACEHOLDER = '__MCP_API_BASE__'

interface Section {
  id: string
  nav: string
  file: string
  keywords?: string
}

export const SECTIONS: Section[] = [
  { id: 'visao-geral', nav: 'Visão geral', file: 'docs/mcp/overview.md', keywords: 'como funciona oauth pkce token sessão papéis ponte whatsapp' },
  { id: 'conectar', nav: 'Conectar um cliente', file: 'docs/mcp/connect.md', keywords: 'conectar compatibilidade clientes tabela' },
  { id: 'cliente-claude-code', nav: 'Guia: Claude Code', file: 'docs/mcp/clients/claude-code.md' },
  { id: 'cliente-claude-ai-desktop', nav: 'Guia: claude.ai e Desktop', file: 'docs/mcp/clients/claude-ai-desktop.md' },
  { id: 'cliente-codex', nav: 'Guia: Codex (OpenAI)', file: 'docs/mcp/clients/codex.md' },
  { id: 'cliente-cursor', nav: 'Guia: Cursor', file: 'docs/mcp/clients/cursor.md' },
  { id: 'cliente-vscode', nav: 'Guia: VS Code (Copilot)', file: 'docs/mcp/clients/vscode.md' },
  { id: 'cliente-windsurf', nav: 'Guia: Windsurf', file: 'docs/mcp/clients/windsurf.md' },
  { id: 'cliente-gemini-cli', nav: 'Guia: Gemini CLI', file: 'docs/mcp/clients/gemini-cli.md' },
  { id: 'cliente-cline', nav: 'Guia: Cline', file: 'docs/mcp/clients/cline.md' },
  { id: 'cliente-zed', nav: 'Guia: Zed', file: 'docs/mcp/clients/zed.md' },
  { id: 'cliente-continue', nav: 'Guia: Continue', file: 'docs/mcp/clients/continue.md' },
  { id: 'cliente-chatgpt', nav: 'Guia: ChatGPT', file: 'docs/mcp/clients/chatgpt.md' },
  { id: 'cliente-mcp-remote', nav: 'Guia: mcp-remote', file: 'docs/mcp/clients/mcp-remote.md' },
  { id: 'ferramentas', nav: 'Ferramentas (30 tools)', file: 'docs/mcp-tools.md', keywords: 'tools ferramentas parâmetros destrutivas confirm' },
  { id: 'seguranca', nav: 'Segurança', file: 'docs/mcp/security.md' },
  { id: 'problemas', nav: 'Solução de problemas', file: 'docs/mcp/troubleshooting.md', keywords: 'erro login sessão expirada 401 429' },
  { id: 'exemplos', nav: 'Exemplos de uso', file: 'docs/mcp/examples.md' },
]

const FILE_TO_ID = new Map(SECTIONS.map((s) => [s.file, s.id]))

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function decodeBasicEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

// Mesmo critério de âncora do GitHub (minúsculas, sem pontuação, espaços viram hífen),
// preservando letras acentuadas.
function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-')
}

function stripFirstH1(md: string): { title: string; body: string } {
  const m = md.match(/^# (.+)\n/)
  if (!m) return { title: '', body: md }
  return { title: m[1].trim(), body: md.slice(m[0].length) }
}

function plainFromHeadingText(m: Marked, text: string): string {
  const html = m.parseInline(text) as string
  return decodeBasicEntities(html.replace(/<[^>]+>/g, ''))
}

// Ids de cabeçalho por seção (com dedupe estilo GitHub), para resolver links
// "arquivo.md#ancora" entre seções antes de renderizar.
function collectAnchors(md: string): Set<string> {
  const m = new Marked()
  const seen = new Map<string, number>()
  const out = new Set<string>()
  for (const t of m.lexer(md)) {
    if (t.type !== 'heading' || t.depth < 2) continue
    const base = slugify(plainFromHeadingText(m, t.text))
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    out.add(n === 0 ? base : `${base}-${n}`)
  }
  return out
}

interface Ctx {
  cardId: string
  file: string
  anchors: Map<string, Set<string>>
}

function resolveHref(href: string, ctx: Ctx): { kind: 'external' | 'internal' | 'none'; href: string } {
  if (/^https?:\/\//i.test(href)) return { kind: 'external', href }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: 'none', href: '' } // javascript:, data:, mailto:, file: ...
  if (href.startsWith('#')) {
    const anchor = href.slice(1)
    return { kind: 'internal', href: ctx.anchors.get(ctx.cardId)?.has(anchor) ? `#${ctx.cardId}-${anchor}` : `#${ctx.cardId}` }
  }
  const [path, anchor] = href.split('#')
  const resolved = posix.normalize(posix.join(posix.dirname(ctx.file), path))
  const id = FILE_TO_ID.get(resolved)
  if (!id) return { kind: 'none', href: '' }
  const cardId = `mcp-${id}`
  return { kind: 'internal', href: anchor && ctx.anchors.get(cardId)?.has(anchor) ? `#${cardId}-${anchor}` : `#${cardId}` }
}

export function renderMarkdown(md: string, ctx: Ctx): string {
  const seen = new Map<string, number>()
  const m: Marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens)
        if (depth < 2) return `<h3>${inner}</h3>\n`
        const base = slugify(decodeBasicEntities(inner.replace(/<[^>]+>/g, '')))
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)
        const id = `${ctx.cardId}-${n === 0 ? base : `${base}-${n}`}`
        const tag = depth === 2 ? 'h3' : depth === 3 ? 'h4' : 'h5'
        return `<${tag} id="${escapeHtml(id)}" style="margin-top:20px">${inner}</${tag}>\n`
      },
      code({ text, lang }) {
        if (lang === 'mermaid') {
          return '<p class="muted">Diagrama disponível na documentação do repositório (docs/mcp/overview.md).</p>\n'
        }
        return (
          '<div class="code" x-data="{ copied:false }">' +
          '<button type="button" class="code-copy" @click="navigator.clipboard.writeText($refs.c.innerText); copied=true; setTimeout(()=>copied=false,1500)" x-text="copied?\'Copiado!\':\'Copiar\'"></button>' +
          `<pre x-ref="c"><code>${escapeHtml(text)}</code></pre></div>\n`
        )
      },
      html({ text }) {
        return escapeHtml(text)
      },
      image({ text }) {
        return escapeHtml(text)
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens)
        const isFileName = /^(\.{1,2}\/)*[\w./-]+\.md$/.test(decodeBasicEntities(inner.replace(/<[^>]+>/g, '')).trim())
        const r = resolveHref(href, ctx)
        if (r.kind === 'none') return isFileName ? `<code>${inner}</code>` : inner
        if (r.kind === 'external') return `<a href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
        const owner = SECTIONS.filter((s) => r.href === `#mcp-${s.id}` || r.href.startsWith(`#mcp-${s.id}-`)).sort(
          (a, b) => b.id.length - a.id.length,
        )[0]
        const label = isFileName && owner ? escapeHtml(owner.nav) : inner
        return `<a href="${escapeHtml(r.href)}">${label}</a>`
      },
      blockquote({ tokens }) {
        return `<div class="callout"><div>${this.parser.parse(tokens)}</div></div>\n`
      },
    },
  })
  const html = m.parse(md) as string
  return html.replace(/<table>/g, '<table class="instances-table">')
}

export function buildPanelMcpDocs(root = process.cwd()): { nav: string; html: string } {
  const sources = SECTIONS.map((s) => {
    const raw = readFileSync(join(root, s.file), 'utf8')
    return { ...s, ...stripFirstH1(raw) }
  })
  const anchors = new Map(sources.map((s) => [`mcp-${s.id}`, collectAnchors(s.body)]))

  const cards: string[] = []
  const navItems: string[] = []
  for (const s of sources) {
    const cardId = `mcp-${s.id}`
    const body = renderMarkdown(s.body, { cardId, file: s.file, anchors })
    cards.push(
      `<div class="card mcp-doc" id="${cardId}" x-show="bate($el.textContent)">\n<h2>${escapeHtml(s.title || s.nav)}</h2>\n${body}</div>\n`,
    )
    const search = escapeHtml(`${s.nav} ${s.title} ${s.keywords ?? ''}`.trim())
    navItems.push(
      `<li><a href="#${cardId}" :class="ativo('${cardId}')" x-show="bate('${search}')">${escapeHtml(s.nav)}</a></li>`,
    )
  }
  const swap = (h: string) => h.split(PROD_BASE).join(API_BASE_PLACEHOLDER)
  return { nav: swap(navItems.join('\n')), html: swap(cards.join('\n')) }
}

export function generatedModuleSource(root = process.cwd()): string {
  const { nav, html } = buildPanelMcpDocs(root)
  return (
    '// GERADO por scripts/gen-panel-mcp-docs.ts a partir de docs/**/*.md — não edite à mão.\n' +
    '// Rode `npm run docs:panel-mcp` depois de mudar a documentação do MCP.\n' +
    `export const MCP_API_BASE_PLACEHOLDER = ${JSON.stringify(API_BASE_PLACEHOLDER)}\n` +
    `export const MCP_DOCS_NAV_HTML = ${JSON.stringify(nav)}\n` +
    `export const MCP_DOCS_HTML = ${JSON.stringify(html)}\n`
  )
}
