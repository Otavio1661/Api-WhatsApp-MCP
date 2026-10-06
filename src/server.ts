// src/server.ts
import 'dotenv/config'
import cluster from 'node:cluster'
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import view from '@fastify/view'
import fastifyStatic from '@fastify/static'
import formbody from '@fastify/formbody'
import { Eta } from 'eta'
import path from 'node:path'
import { config } from './config'
import { formatarDataHora } from './utils/datas'
import { resolveTenantContext } from './middlewares/auth.middleware'
import { messagesRoutes } from './routes/messages.route'
import { inboundMessagesRoutes } from './routes/inbound-messages.route'
import { instancesRoutes } from './routes/instances.route'
import { adminRoutes } from './routes/admin.route'
import { authRoutes } from './routes/auth.route'
import { accountRoutes } from './routes/account.route'
import { metricsRoutes } from './routes/metrics.route'
import { campaignsRoutes } from './routes/campaigns.route'
import { panelRoutes } from './web/panel.route'
// Garante a augmentação de tipos do Fastify/@fastify/jwt (apiClient/authUser/payload)
import './types'
import { webhooksRoutes, healthRoutes, inboundWebhooksRoutes } from './routes/webhooks.route'
import { mcpOAuthRoutes } from './routes/mcp-oauth.route'
import { mcpMetadataRoutes } from './routes/mcp-metadata.route'
import { mcpRoutes } from './routes/mcp.route'
import { prisma } from './utils/prisma'
import { redis } from './utils/redis'
import { startSendMessageWorker, stopSendMessageWorker } from './queues/send-message.worker'
import { startWebhookWorker, stopWebhookWorker } from './queues/webhook.worker'
import { startScheduler, stopScheduler } from './queues/scheduler'

// ── Fábrica do app ────────────────────────────────────────────
// Cria a instância Fastify, registra TODOS os plugins e TODAS as rotas e devolve o
// `app` PRONTO — porém SEM `.listen()` e SEM conectar Prisma/Redis/workers. Isso
// permite que os testes (Vitest + app.inject) montem o app de forma isolada, sem
// depender de banco/Redis/processos de fundo. O bootstrap de runtime fica em start().
export function buildApp(): FastifyInstance {
  const app = Fastify({
    // Sob Vitest (process.env.VITEST), silencia o logger para não poluir a saída dos
    // testes. NÃO afeta runtime: `npm run dev`/produção mantêm o logger Pino normal.
    logger: process.env.VITEST
      ? false
      : {
          transport: config.app.isDev
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        },
    // Sem isto, `request.ip` sempre resolvia pro gateway Docker (um proxy reverso/túnel
    // rodando no host, fora do compose, chega no container por ali) — todo o tráfego
    // externo virava um "IP" só, inutilizando qualquer rate-limit por IP. 'loopback' +
    // 'uniquelocal' confia só nas faixas privadas (RFC1918) — nunca alcançáveis por um
    // IP público de verdade — então o X-Forwarded-For só é honrado quando o hop
    // imediato é realmente interno; um atacante externo não consegue se passar por isso
    // não importa o header que ele mande.
    trustProxy: ['loopback', 'uniquelocal'],
  })

  // ── Plugins ───────────────────────────────────────────────────
  // CORS restrito só à origem do painel: /admin e a API (/v1) vivem em
  // subdomínios diferentes (panel.example.com vs api.example.com), e o
  // playground "Testar recursos" do painel chama a API direto do navegador
  // (ver src/web/views/instance.eta) — isso É cross-origin de verdade,
  // então precisa de CORS. A remoção anterior partia de premissa que não é
  // mais verdade desde a separação de domínio (achado depurando por que o
  // playground só dava "NetworkError", 2026-08-10). `origin` fixo (não
  // `true`/reflect-any) e sem `credentials` — os endpoints daqui usam Token/
  // Bearer explícitos no header, nunca cookie, então não há sessão pra
  // vazar por CSRF cross-origin mesmo liberando a origem do próprio painel.
  app.register(cors, {
    // Função em vez de string fixa: com string, o @fastify/cors sempre ecoa
    // o valor configurado no header, contando só com o navegador pra
    // comparar contra a Origin real da chamada. Validando aqui, o próprio
    // servidor nunca declara a origem como permitida pra quem não bate —
    // defesa em profundidade além do que o browser já garante sozinho.
    origin: (origin, cb) => cb(null, origin === config.app.panelPublicUrl),
    credentials: false,
  })

  // helmet: registrado com `global: false` — NENHUMA rota recebe os headers
  // automaticamente. Quem decide é o hook onRequest logo abaixo, que chama
  // `reply.helmet(...)` explicitamente pra CADA request:
  //   - /admin/*  → CSP relaxado (só o necessário pro painel: Alpine via CDN
  //     jsdelivr, <script>/onsubmit= inline do Eta, fonte Inter do Google Fonts,
  //     fetch cross-origin do playground pra apiPublicUrl — ver instance.eta).
  //   - qualquer outra rota (/v1/* da API REST, /health etc.) → CSP padrão do
  //     helmet (`reply.helmet()` sem overrides), com default-src/script-src
  //     restritos a 'self'. A API é só JSON, não renderiza HTML — não perde
  //     nada mantendo o CSP padrão bloqueando tudo.
  // Ver antes disso, `contentSecurityPolicy: false` desligava a CSP
  // pro app INTEIRO — inclusive pra API, sem ganho nenhum em desligar lá.
  app.register(helmet, { global: false })

  // CSP do painel: só as fontes externas que o Eta realmente carrega (checado em
  // src/web/views/*.eta antes de escrever isto — ver comentário acima). Nada de
  // 'unsafe-inline'/'unsafe-eval' vaza pra API: este objeto só é usado no branch
  // /admin do hook logo abaixo.
  const ADMIN_CSP = {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Alpine.js (CDN) + os poucos <script> inline do layout/telas do painel.
        // Alpine precisa de 'unsafe-eval': ele avalia x-data/x-on via `Function()`,
        // não tem como restringir mais sem trocar pro build @alpinejs/csp (fora de
        // escopo aqui).
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.jsdelivr.net'],
        // onsubmit="..." nos formulários do painel (instance/team/manage/webhooks
        // .eta): script-src NÃO cobre atributos inline, é a diretiva
        // script-src-attr (senão cai no default do helmet, que é 'none' e
        // quebraria todo submit).
        scriptSrcAttr: ["'unsafe-inline'"],
        // style="..." espalhado pelas views + a fonte Inter (Google Fonts) via
        // <link> no layout e @import no login.eta.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        // O playground "Testar recursos" (instance.eta) chama a API REST direto
        // do navegador, em domínio diferente do painel (ver comentário do CORS
        // acima) — sem isso o fetch() é bloqueado mesmo com CORS liberado.
        connectSrc: ["'self'", config.app.apiPublicUrl],
        // Explícito (em vez de confiar no default implícito do helmet) — visto
        // ao vivo um "form-action 'self' violado" no console de um usuário
        // tentando logar no /mcp/oauth/authorize (2026-09-28); suspeita forte
        // de ser uma extensão de navegador interceptando o form (os outros
        // scripts bloqueados na mesma sessão — ex.: beacons injetados por
        // proxies — não existem em nenhuma view deste projeto), mas deixar
        // explícito elimina qualquer ambiguidade de merge de default.
        formAction: ["'self'"],
      },
    },
  }

  // Único ponto que decide CSP por rota (ver comentário do register acima).
  // Precisa ficar DEPOIS do `app.register(helmet, ...)` pra que o decorator
  // `reply.helmet` já exista quando este hook rodar.
  app.addHook('onRequest', async (request, reply) => {
    // /mcp/oauth/authorize é a única rota do MCP que renderiza HTML (reusa
    // login.eta) — precisa do MESMO CSP relaxado do painel. /mcp, /mcp/oauth/
    // token e /mcp/oauth/register são só JSON, ficam no CSP restrito padrão.
    // startsWith (não ===): o GET real sempre vem com querystring
    // (?response_type=code&client_id=...) — comparação exata nunca batia
    // pro GET, só pro POST (sem querystring), achado ao vivo em 2026-09-28.
    if (request.url.startsWith('/admin') || request.url.startsWith('/mcp/oauth/authorize')) {
      await reply.helmet(ADMIN_CSP)
    } else {
      await reply.helmet()
    }
  })

  // Compressão de resposta (API JSON e painel HTML): brotli quando o client aceita
  // (`Accept-Encoding: br`), com fallback automático para gzip — é a ordem de
  // preferência padrão do @fastify/compress, sem precisar declarar encodings à mão.
  app.register(compress)

  // Cookies (sessão do painel via cookie httpOnly `token`). Deve vir ANTES do jwt
  // para que o @fastify/jwt consiga ler o cookie em request.jwtVerify().
  app.register(cookie)

  // JWT para login humano: aceita o header `Authorization: Bearer` (API REST) E o
  // cookie `token` (painel web). A API REST continua funcionando com Bearer/API key.
  app.register(jwt, {
    secret: config.app.jwtSecret,
    sign: { expiresIn: config.app.jwtExpiresIn },
    cookie: { cookieName: 'token', signed: false },
  })

  // Body parser para formulários HTML (application/x-www-form-urlencoded).
  app.register(formbody)

  // Fallback para requisições sem corpo e sem Content-Type (ex.: fetch(url, { method: 'POST' })
  // sem body). Direto no localhost isso não tem problema, mas atrás de alguns proxies/túneis a
  // requisição chega com Content-Length: 0 e Content-Type ausente, e o Fastify rejeita por
  // padrão com FST_ERR_CTP_INVALID_MEDIA_TYPE (415 "Unsupported Media Type: undefined").
  app.addContentTypeParser('*', (_request, _payload, done) => done(null, undefined))

  // View engine (Eta) para o painel server-rendered.
  const eta = new Eta({ views: path.join(__dirname, 'web', 'views') })
  app.register(view, {
    engine: { eta },
    root: path.join(__dirname, 'web', 'views'),
    // Disponível como it.fmtData em TODAS as views, sem precisar repetir o
    // helper em cada payload de render. Ver utils/datas.ts: sem fixar o fuso,
    // as telas mostravam horário UTC com formato brasileiro (3h adiantado).
    defaultContext: { fmtData: formatarDataHora },
  })

  // Estáticos do painel (CSS) em /admin/assets.
  app.register(fastifyStatic, {
    root: path.join(__dirname, 'web', 'public'),
    prefix: '/admin/assets/',
  })

  // Resolve o tenant ANTES do rate-limit (hook onRequest registrado primeiro,
  // portanto executado antes do hook do @fastify/rate-limit).
  app.addHook('onRequest', resolveTenantContext)

  // Observabilidade: log estruturado por request COM contexto de tenant (resolvido no
  // onRequest acima). Facilita rastrear uso/erros por conta. Ignora ruído (health/assets).
  app.addHook('onResponse', async (request, reply) => {
    if (request.url === '/health' || request.url.startsWith('/admin/assets/')) return
    request.log.info(
      {
        tenant: request.apiClient?.id,
        tenantName: request.apiClient?.name,
        userId: request.authUser?.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
      },
      'request',
    )
  })

  // Rate limit POR TENANT: a chave é o id do ApiClient (cai p/ IP se anônimo) e o
  // teto é o `rateLimit` do próprio cliente. /health e os webhooks inbound dos
  // providers ficam de fora (alto volume legítimo).
  app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    // Store no Redis: a contagem é global entre réplicas (sem ele, o teto efetivo
    // de um tenant seria N × rateLimit com N processos).
    redis,
    max: (request) => request.apiClient?.rateLimit ?? config.app.defaultRateLimit,
    keyGenerator: (request) => request.apiClient?.id ?? request.ip,
    // Isenta só o /admin/login (GET tela + POST submit) e os estáticos do painel
    // (CSS/JS/img, /admin/assets/) — ambos sem sessão, precisam ficar de fora pra
    // não travar a tela de login nem quebrar a UI (fetch de asset é IP-anônimo).
    // Login já tem proteção própria de força bruta (verificarBloqueio, por
    // IP+e-mail+dispositivo — panel.route.ts), então ficar fora deste rate-limit
    // global não deixa a rota desprotegida. Todo o resto de /admin/* (gestão
    // pós-login: criar/editar/apagar cliente/usuário/instância) passa a contar
    // pro teto — antes ficava TODO /admin fora, então uma sessão sequestrada via
    // XSS não tinha teto nenhum de requisições.
    allowList: (request) =>
      request.url === '/health' ||
      request.url.includes('/webhooks/inbound/') ||
      request.url === '/admin/login' ||
      request.url.startsWith('/admin/assets/') ||
      // /mcp/oauth/authorize já tem proteção própria de força bruta
      // (verificarBloqueio, mesma do /admin/login) — ficar fora deste teto
      // genérico evita que o próprio handshake OAuth (redirects/retries
      // legítimos do navegador) esbarre num limite pensado pra tráfego de API.
      // startsWith (não ===): o GET real sempre vem com querystring — a
      // comparação exata nunca isentava o GET do teto genérico, só o POST.
      request.url.startsWith('/mcp/oauth/authorize'),
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit excedido para este cliente',
    }),
  })

  // ── Rotas ─────────────────────────────────────────────────────
  app.register(healthRoutes)
  app.register(authRoutes, { prefix: '/v1' })
  app.register(accountRoutes, { prefix: '/v1' })
  app.register(metricsRoutes, { prefix: '/v1' })
  app.register(campaignsRoutes, { prefix: '/v1' })
  app.register(messagesRoutes, { prefix: '/v1' })
  app.register(inboundMessagesRoutes, { prefix: '/v1' })
  app.register(instancesRoutes, { prefix: '/v1' })
  app.register(adminRoutes, { prefix: '/v1' })
  app.register(webhooksRoutes, { prefix: '/v1' })
  // Webhooks inbound dos providers (sem auth por API key — escopo via providerId + instância)
  app.register(inboundWebhooksRoutes, { prefix: '/v1' })
  // Painel web server-rendered (estilo de gateways de WhatsApp), sessão via cookie httpOnly.
  app.register(panelRoutes, { prefix: '/admin' })

  // ── MCP remoto (OAuth 2.1 + transporte) ────────────────────────
  // Metadata (.well-known/*) fica SEM prefixo, na raiz — é onde o spec de
  // descoberta OAuth exige que os clients (Claude Desktop/Code) busquem.
  app.register(mcpMetadataRoutes)
  app.register(mcpOAuthRoutes, { prefix: '/mcp/oauth' })
  app.register(mcpRoutes, { prefix: '/mcp' })

  // ── Handler de erro global ──────────────────────────
  // Sem isso, uma exceção não tratada (ex. erro do Prisma/driver) cai no
  // handler default do Fastify, que devolve `error.message` cru — no MCP
  // isso é particularmente sensível porque `inject-helper.ts` repassa o
  // corpo inteiro da resposta de volta pro cliente MCP sem filtrar nada.
  // Erros JÁ tratados (rotas que fazem `reply.status(...).send(...)`
  // diretamente) nunca passam por aqui — só exceções de verdade.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error, url: request.url }, 'Erro não tratado')
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500
    if (statusCode >= 500) {
      return reply.status(statusCode).send({ statusCode, error: 'Internal Server Error', message: 'Erro interno. Tente novamente mais tarde.' })
    }
    return reply.status(statusCode).send({ statusCode, error: error.name, message: error.message })
  })

  return app
}

// Instância usada pelo runtime (dev/prod). Em testes, cada caso monta a sua via buildApp().
const app = buildApp()

// ── Inicialização ─────────────────────────────────────────────
async function start() {
  try {
    // Conecta ao banco
    await prisma.$connect()
    app.log.info('✅ PostgreSQL conectado')

    // Conecta ao Redis
    await redis.connect()
    app.log.info('✅ Redis conectado')

    // Worker de envio assíncrono (BullMQ)
    startSendMessageWorker()
    app.log.info('✅ Worker send-message iniciado')

    // Worker de entrega de webhooks (retry/backoff + DLQ + HMAC)
    startWebhookWorker()
    app.log.info('✅ Worker webhook-delivery iniciado')

    // Scheduler: repeatable jobs (reset-counters meia-noite + scheduled-messages a cada min)
    // Substitui o resetDailyCounters() que antes rodava só no boot dev.
    await startScheduler()
    app.log.info('✅ Scheduler (reset-counters + scheduled-messages) iniciado')

    // Inicia servidor
    await app.listen({ port: config.app.port, host: '0.0.0.0' })
    app.log.info(`🚀 ApiEnvios rodando em http://localhost:${config.app.port}`)
    app.log.info(`📋 Ambiente: ${config.app.env}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// ── Graceful shutdown ─────────────────────────────────────────
async function shutdown(signal: string) {
  app.log.info(`Recebido ${signal}, encerrando...`)
  try {
    await app.close()
    await stopSendMessageWorker()
    await stopWebhookWorker()
    await stopScheduler()
    await prisma.$disconnect()
    redis.disconnect()
  } catch (err) {
    app.log.error(err)
  } finally {
    process.exit(0)
  }
}

// Só inicializa o runtime (listen + Prisma/Redis/workers/sinais) quando o módulo é
// EXECUTADO DIRETAMENTE (node/tsx src/server.ts). Na importação pelos testes, este
// guard evita abrir servidor, conexões e handlers de sinal.
//
// Cluster Node nativo (sem PM2, sem dependência nova): CLUSTER_WORKERS > 1 faz o
// processo primário só forkar N réplicas e distribuir as conexões TCP entre elas
// (round-robin nativo do Node/Linux) — o proxy reverso da frente não muda
// nada, continua falando com um único host:porta. Cada réplica roda o start()
// INTEIRO (HTTP + send-worker + webhook-worker + scheduler) — seguro porque tudo já
// é coordenado via Redis/BullMQ, sem estado só-em-memória (ver comentários em
// send-message.worker.ts e scheduler.ts). Default (variável não setada) = 1
// processo só, comportamento idêntico ao de antes desta mudança.
if (require.main === module) {
  const clusterWorkers = Number(process.env.CLUSTER_WORKERS ?? 1)
  if (clusterWorkers > 1 && cluster.isPrimary) {
    for (let i = 0; i < clusterWorkers; i++) cluster.fork()
    cluster.on('exit', (worker, code, signal) => {
      app.log.error(`[Cluster] Worker Node ${worker.process.pid} morreu (${signal ?? code}) — reiniciando`)
      cluster.fork()
    })
  } else {
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
    start()
  }
}
