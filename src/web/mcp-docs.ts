// src/web/mcp-docs.ts
// Documentação do MCP para a página Docs do painel. O HTML vem pronto de
// mcp-docs.generated.ts (gerado a partir de docs/**/*.md por
// scripts/gen-panel-mcp-docs.ts — uma única fonte); aqui só se troca a URL base
// pela do ambiente em cada request.
import { MCP_API_BASE_PLACEHOLDER, MCP_DOCS_HTML, MCP_DOCS_NAV_HTML } from './mcp-docs.generated'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function renderMcpDocs(apiBase: string): { nav: string; html: string } {
  const base = escapeHtml(apiBase.replace(/\/$/, ''))
  return {
    nav: MCP_DOCS_NAV_HTML.split(MCP_API_BASE_PLACEHOLDER).join(base),
    html: MCP_DOCS_HTML.split(MCP_API_BASE_PLACEHOLDER).join(base),
  }
}
