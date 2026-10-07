// Dados FICTÍCIOS de demonstração para ver o painel "cheio" sem WhatsApp real.
// Uso: npm run demo:seed   (recusa rodar com NODE_ENV=production)
// Telefones 55000000xxxxx e e-mails @example.com não existem. Tudo é apagável com
// `npm run demo:seed -- --reset` (remove só o tenant "Demo").
import { PrismaClient, MessageStatus } from '@prisma/client'
import { hashPassword } from '../../src/utils/password'
import { encryptSecret, hashForLookup } from '../../src/utils/secrets-crypto'
import { randomBytes } from 'node:crypto'

if (process.env.NODE_ENV === 'production') {
  console.error('Recusado: o seed de demonstração não roda em produção.')
  process.exit(1)
}

const prisma = new PrismaClient()
const DEMO_PASSWORD = 'demo123456'
const DAY = 86_400_000
// Gerador determinístico: a demo fica igual a cada execução.
let seed = 42
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]
const secret = (p: string) => `${p}-${randomBytes(8).toString('hex')}`

const INSTANCES = [
  { name: 'Vendas', slug: 'demo-vendas', conn: 'CONNECTED', phone: '5500000000101' },
  { name: 'Suporte', slug: 'demo-suporte', conn: 'CONNECTED', phone: '5500000000102' },
  { name: 'Financeiro', slug: 'demo-financeiro', conn: 'CONNECTED', phone: '5500000000103' },
  { name: 'Marketing', slug: 'demo-marketing', conn: 'CONNECTED', phone: '5500000000104' },
  { name: 'Novo número', slug: 'demo-novo-numero', conn: 'QR_PENDING', phone: null },
  { name: 'Reserva', slug: 'demo-reserva', conn: 'DISCONNECTED', phone: '5500000000106' },
] as const

const TEXTS = ['Olá! Seu pedido foi confirmado.', 'Seu código de verificação é 482913.', 'Lembrete: reunião amanhã às 10h.',
  'Sua fatura vence em 3 dias.', 'Obrigado pelo contato! Em que posso ajudar?', 'Seu pagamento foi aprovado.', 'Promoção válida até sexta!']

async function reset() {
  const c = await prisma.apiClient.findFirst({ where: { name: 'Demo' } })
  if (!c) return
  await prisma.messageAttempt.deleteMany({ where: { message: { apiClientId: c.id } } })
  await prisma.message.deleteMany({ where: { apiClientId: c.id } })
  await prisma.campaign.deleteMany({ where: { apiClientId: c.id } })
  await prisma.webhook.deleteMany({ where: { apiClientId: c.id } })
  await prisma.instanceNumber.deleteMany({ where: { instance: { apiClientId: c.id } } })
  await prisma.instance.deleteMany({ where: { apiClientId: c.id } })
  await prisma.user.deleteMany({ where: { apiClientId: c.id } })
  await prisma.apiClient.delete({ where: { id: c.id } })
  console.log('Tenant Demo removido.')
}

async function main() {
  await reset()
  if (process.argv.includes('--reset')) return
  const key = secret('demo')
  const client = await prisma.apiClient.create({
    data: { name: 'Demo', apiKey: encryptSecret(key), apiKeyHash: hashForLookup(key), role: 'ADMIN', active: true,
      rateLimit: 1000, maxInstances: 20, maxPerRecipientPerHour: 0, fallbackEnabled: true },
  })
  const pw = await hashPassword(DEMO_PASSWORD)
  const admin = await prisma.user.create({ data: { email: 'admin@example.com', name: 'Admin Demo', role: 'SUPER_ADMIN', passwordHash: pw, emailVerified: true, apiClientId: client.id } })
  const members = [
    await prisma.user.create({ data: { email: 'ana@example.com', name: 'Ana (vendas)', role: 'MEMBER', passwordHash: pw, emailVerified: true, apiClientId: client.id } }),
    await prisma.user.create({ data: { email: 'bruno@example.com', name: 'Bruno (suporte)', role: 'MEMBER', passwordHash: pw, emailVerified: true, apiClientId: client.id } }),
  ]
  const insts = []
  for (const [i, d] of INSTANCES.entries()) {
    const tok = secret('demo-inst')
    const inst = await prisma.instance.create({
      data: { name: d.name, slug: d.slug, phone: d.phone, label: 'Demonstração', provider: 'EVOLUTION', instanceId: d.slug,
        status: 'ACTIVE', priority: i, token: encryptSecret(tok), tokenHash: hashForLookup(tok),
        webhookSecret: encryptSecret(secret('ws')), connectionState: d.conn, apiClientId: client.id,
        ownerUserId: i === 0 ? members[0].id : i === 1 ? members[1].id : null },
    })
    await prisma.instanceNumber.create({
      data: { instanceId: inst.id, provider: 'EVOLUTION', providerInstanceId: d.slug, phone: d.phone, label: 'Número 1',
        status: 'ACTIVE', connectionState: d.conn },
    })
    insts.push(inst)
  }
  const connected = insts.filter((_, i) => INSTANCES[i].conn === 'CONNECTED')
  const campaigns = []
  for (const [n, total] of [['Black Friday (demo)', 120], ['Aviso de manutenção (demo)', 60]] as const) {
    campaigns.push(await prisma.campaign.create({ data: { name: n, total, apiClientId: client.id, instanceId: connected[0].id, createdByUserId: admin.id, createdAt: new Date(Date.now() - 2 * DAY) } }))
  }
  const dist: [MessageStatus, number][] = [['READ', 40], ['DELIVERED', 35], ['SENT', 12], ['FAILED', 6], ['QUEUED', 4], ['SCHEDULED', 3]]
  const roll = () => { let r = rnd() * 100; for (const [s, w] of dist) { if ((r -= w) < 0) return s } return 'SENT' as MessageStatus }
  const rows = []
  for (let i = 0; i < 520; i++) {
    const inst = pick(connected); const status = roll()
    const camp = i < 180 ? campaigns[i < 120 ? 0 : 1] : null
    const created = new Date(Date.now() - rnd() * 14 * DAY)
    const sent = ['SENT', 'DELIVERED', 'READ'].includes(status) ? new Date(created.getTime() + 2000) : null
    rows.push({
      apiClientId: client.id, toPhone: '55000000' + String(10000 + Math.floor(rnd() * 90000)), type: 'TEXT' as const, content: pick(TEXTS),
      instanceId: inst.id, provider: 'EVOLUTION' as const, providerId: 'MOCK' + i, status, campaignId: camp?.id,
      createdByUserId: i % 5 === 0 ? admin.id : null, createdAt: created, sentAt: sent,
      deliveredAt: status === 'DELIVERED' || status === 'READ' ? new Date(created.getTime() + 5000) : null,
      readAt: status === 'READ' ? new Date(created.getTime() + 60000) : null,
      failedAt: status === 'FAILED' ? new Date(created.getTime() + 3000) : null,
      errorMessage: status === 'FAILED' ? 'Número sem WhatsApp (simulado)' : null,
      scheduledAt: status === 'SCHEDULED' ? new Date(Date.now() + DAY) : null,
    })
  }
  await prisma.message.createMany({ data: rows })
  for (const [url, events] of [
    ['https://erp.example.com/hooks/whatsapp', ['MESSAGE_FAILED', 'BAN_DETECTED']],
    ['https://crm.example.com/webhooks/status', ['MESSAGE_FAILED']],
    ['https://alertas.example.com/api/numero', ['NUMBER_ROTATED', 'BAN_DETECTED']],
  ] as const) await prisma.webhook.create({ data: { url, events: [...events], apiClientId: client.id, secret: secret('whsec') } })
  console.log(`Demo pronta. Login no painel: admin@example.com / ${DEMO_PASSWORD}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
