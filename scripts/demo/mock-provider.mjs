// Provedor SIMULADO, só para demonstração local. Imita o mínimo da API da Evolution
// que o painel usa (criar/conectar/estado/envio/webhook). Não fala com o WhatsApp.
// Uso: npm run demo:provider   (porta 8080; troque com MOCK_PROVIDER_PORT)
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.MOCK_PROVIDER_PORT ?? 8080)
const open = new Set(['demo-vendas', 'demo-suporte', 'demo-financeiro', 'demo-marketing'])

// "QR" ilustrativo (NÃO é lido por nenhum celular): matriz pseudo-aleatória em SVG.
function fakeQr(seed) {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const n = 29
  let rects = ''
  const finder = (x, y) => x < 8 && y < 8 || x > n - 9 && y < 8 || x < 8 && y > n - 9
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    s = (s * 1664525 + 1013904223) >>> 0
    const on = finder(x, y) ? (x % 7 === 0 || y % 7 === 0 || (x % 7 > 1 && x % 7 < 5 && y % 7 > 1 && y % 7 < 5)) : s >>> 28 > 7
    if (on) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><g fill="#000">${rects}</g></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

http.createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0]
  req.resume()
  req.on('end', () => {
    let m
    if ((m = path.match(/^\/message\/(sendText|sendMedia|sendWhatsAppAudio|sendSticker)\/(.+)$/)) && req.method === 'POST')
      return json(res, 201, { key: { id: 'MOCK' + randomUUID().slice(0, 12).toUpperCase() }, status: 'PENDING' })
    if ((m = path.match(/^\/instance\/connectionState\/(.+)$/)))
      return json(res, 200, { instance: { instanceName: m[1], state: open.has(m[1]) ? 'open' : 'connecting' } })
    if ((m = path.match(/^\/instance\/connect\/(.+)$/))) return json(res, 200, { base64: fakeQr(m[1]) })
    if (path === '/instance/create' && req.method === 'POST') {
      return json(res, 201, { instance: { instanceName: 'demo-novo' }, qrcode: { base64: fakeQr('demo-novo' + Date.now()) } })
    }
    if (path.startsWith('/instance/delete/')) return json(res, 200, { status: 'SUCCESS' })
    if (path.startsWith('/webhook/set/')) return json(res, 201, { enabled: true })
    json(res, 404, { error: 'rota não simulada', path })
  })
}).listen(PORT, '127.0.0.1', () => console.log(`Provedor simulado (demo) em http://127.0.0.1:${PORT}`))
