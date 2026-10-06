// Copia as views e os arquivos públicos do painel para dist/web depois do `tsc`.
// Sem isso, `npm run build && npm start` fora do Docker não encontra os templates
// (o Dockerfile faz a mesma cópia na imagem final).
import { cpSync, existsSync } from 'node:fs'

for (const dir of ['views', 'public']) {
  const origem = `src/web/${dir}`
  if (!existsSync(origem)) {
    console.error(`copy-web-assets: ${origem} não encontrado`)
    process.exit(1)
  }
  cpSync(origem, `dist/web/${dir}`, { recursive: true })
}
console.log('copy-web-assets: views e public copiadas para dist/web')
