// scripts/gen-panel-mcp-docs.ts
// Gera src/web/mcp-docs.generated.ts (documentação do MCP em HTML, para a página Docs do
// painel) a partir de docs/**/*.md — uma única fonte, sem cópia à mão.
//
//   npm run docs:panel-mcp          -> reescreve src/web/mcp-docs.generated.ts
//   npm run docs:panel-mcp:check    -> sai com 1 se o arquivo estiver desatualizado
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generatedModuleSource } from '../src/web/mcp-docs-builder'

const root = join(__dirname, '..')
const OUT = join(root, 'src', 'web', 'mcp-docs.generated.ts')
const next = generatedModuleSource(root)

if (process.argv.includes('--check')) {
  let cur = ''
  try {
    cur = readFileSync(OUT, 'utf8')
  } catch {
    /* ausente */
  }
  if (cur !== next) {
    console.error('src/web/mcp-docs.generated.ts está desatualizado. Rode: npm run docs:panel-mcp')
    process.exit(1)
  }
  console.log('src/web/mcp-docs.generated.ts está atualizado.')
} else {
  writeFileSync(OUT, next)
  console.log(`src/web/mcp-docs.generated.ts gerado (${next.length} bytes).`)
}
