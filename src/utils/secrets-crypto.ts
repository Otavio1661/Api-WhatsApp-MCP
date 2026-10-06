// src/utils/secrets-crypto.ts
// Criptografia reversível (AES-256-GCM) para segredos de tenant que precisam
// ser exibidos em claro no painel (Instance.token, Instance.webhookSecret,
// ApiClient.apiKey) — diferente de senha (hash puro), aqui o valor tem que
// voltar. 
//
// Chave mestra: SECRETS_ENCRYPTION_KEY (env), NUNCA no schema/migration/git.
// Gerar com: `openssl rand -base64 32`. Em produção, configurar via o gerenciador
// de segredos do seu ambiente (ver .env.example).
//
// Duas subchaves são derivadas da mesma chave mestra via HKDF (não reusar a
// mesma chave crua em duas primitivas diferentes):
//  - uma para AES-256-GCM (armazenamento reversível)
//  - outra para HMAC-SHA256 (índice cego / "blind index" de busca — ver abaixo)
//
// Por que existe hashForLookup(): Instance.token e ApiClient.apiKey são usados
// como CHAVE DE BUSCA no banco (`WHERE token = ?`, `WHERE apiKey = ?`) no auth
// middleware, em TODO request. Criptografia com IV aleatório é não-determinística
// (o mesmo valor gera ciphertext diferente a cada vez), então não dá pra fazer
// esse WHERE direto contra a coluna cifrada. Solução padrão: guardar também um
// HMAC determinístico do valor em claro (indexado, único) e buscar por ele; o
// valor cifrado continua guardado só para poder ser decriptado e exibido.
// Instance.webhookSecret NÃO tem hash de busca: nunca é usado como filtro,
// sempre é comparado depois de o registro já ter sido buscado por id.
import { randomBytes, createHmac, createCipheriv, createDecipheriv, hkdfSync, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // recomendado para GCM
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32 // AES-256

// Lê e valida a chave mestra SOB DEMANDA (não no boot da app, e sem cache
// module-level) — assim a API continua no ar normalmente mesmo sem a env var
// setada; só quebra (com erro claro) quando alguém tenta de fato
// cifrar/decriptar/hashear algo. Isso importa especialmente durante a
// transição: dado legado em texto puro nunca chama isto (decryptSecretIfNeeded
// faz passthrough), só a CRIAÇÃO de novos segredos ou a leitura de um valor JÁ
// cifrado exige a chave. Sem cache: o custo de reler/reconverter a env var é
// desprezível (não é hot path por si só — HKDF é que já é barato) e evita
// estado global surpreendente (ex.: troca de chave em runtime, testes).
function getMasterKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY não configurada. Gere uma com `openssl rand -base64 32` e configure ' +
        'via variável de ambiente (ver .env.example).',
    )
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY inválida: esperado ${KEY_LENGTH} bytes após decodificar base64, recebido ${key.length}.`,
    )
  }

  return key
}

// Deriva uma subchave de uso único (AES ou HMAC) a partir da chave mestra via
// HKDF-SHA256, isolando o uso de cada primitiva. `info` diferencia as duas.
function deriveKey(info: string): Buffer {
  const master = getMasterKey()
  const derived = hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(info, 'utf8'), KEY_LENGTH)
  return Buffer.from(derived)
}

function encKey(): Buffer {
  return deriveKey('apienvios:secrets-crypto:aes-gcm')
}

function hmacKey(): Buffer {
  return deriveKey('apienvios:secrets-crypto:hmac-lookup')
}

// Cifra um valor em claro. Formato de armazenamento: "iv:tag:ciphertext",
// cada segmento em base64. IV aleatório por valor (não determinístico).
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, encKey(), iv, { authTagLength: AUTH_TAG_LENGTH })
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

// Decripta um valor no formato "iv:tag:ciphertext". Lança se o formato for
// inválido, a tag não bater (adulterado/chave errada) ou a chave estiver ausente.
export function decryptSecret(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 3) {
    throw new Error('Formato de segredo cifrado inválido (esperado "iv:tag:ciphertext").')
  }
  const [ivB64, tagB64, dataB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(dataB64, 'base64')

  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Formato de segredo cifrado inválido (tamanho de iv/tag inesperado).')
  }

  const decipher = createDecipheriv(ALGORITHM, encKey(), iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

// Detecta (heuristicamente) se um valor já está no formato cifrado desta
// função — permite conviver com dado legado em texto puro durante a
// transição, sem exigir a migração de dados ter rodado.
export function looksEncrypted(value: string): boolean {
  const parts = value.split(':')
  if (parts.length !== 3) return false
  const [ivB64, tagB64, dataB64] = parts
  try {
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    // dataB64 vazio é válido (string vazia cifrada), só validamos que decodifica.
    Buffer.from(dataB64, 'base64')
    return iv.length === IV_LENGTH && tag.length === AUTH_TAG_LENGTH
  } catch {
    return false
  }
}

// Decripta se o valor já estiver cifrado; caso contrário retorna como está
// (dado legado em texto puro, ainda não migrado — ver script de migração de
// dados). Uso: todo ponto de LEITURA de token/webhookSecret/apiKey deve passar
// por aqui antes de exibir/usar o valor.
export function decryptSecretIfNeeded(value: string): string {
  if (!looksEncrypted(value)) return value
  return decryptSecret(value)
}

// HMAC-SHA256 determinístico (hex) do valor em claro — índice cego usado para
// busca (`tokenHash`, `apiKeyHash`). NUNCA usar isto para decidir se algo "é"
// um segredo válido sem também checar o registro correspondente no banco.
export function hashForLookup(plaintext: string): string {
  return createHmac('sha256', hmacKey()).update(plaintext, 'utf8').digest('hex')
}

// Variante "best effort" de hashForLookup: null se SECRETS_ENCRYPTION_KEY não
// estiver configurada, em vez de lançar. Uso: no auth middleware, ANTES da
// migração de dados/configuração da chave em produção, a busca não pode
// depender de hash — precisa continuar funcionando só com o valor em texto
// puro (comportamento idêntico ao de antes desta feature). Depois que a chave
// estiver configurada, volta a hashear normalmente e passa a aproveitar o
// índice cego pros registros já migrados.
export function tryHashForLookup(plaintext: string): string | null {
  try {
    return hashForLookup(plaintext)
  } catch {
    return null
  }
}

// Gera um novo valor de segredo em claro (substitui o antigo `@default(cuid())`
// do schema, removido porque a coluna agora guarda o valor CIFRADO — a geração
// precisa acontecer em código para que o valor em claro fique disponível para
// cifrar + hashear antes do INSERT, e para devolver ao caller/exibir uma vez).
// 32 bytes de entropia, url-safe.
export function generateSecretValue(): string {
  return randomBytes(32).toString('base64url')
}

// Comparação em tempo constante de dois segredos em claro (mesmo uso de
// `timingSafeEqual` já usado em webhooks.route.ts, mas dando forma reutilizável
// à checagem de tamanho diferente sem cair fora do tempo constante).
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

// ── Helpers genéricos de decriptação por objeto (Instance/ApiClient) ──────
// Tipados estruturalmente (não importam @prisma/client) pra serem reusáveis
// em qualquer camada (middleware, services, rotas) sem acoplar este módulo ao
// Prisma. Todo ponto que anexa um ApiClient/Instance vindo do banco a
// request.apiClient/request.instance, ou que devolve um desses objetos pra
// exibição (painel/API), deve passar por aqui — garante que quem consome
// esses objetos NUNCA vê o valor cifrado, seja o dado legado (texto puro,
// passthrough) ou já migrado (decripta).
// Defensivo quanto a campo ausente/não-string (ex.: objeto parcial de teste,
// ou um `select` que não trouxe o campo) — nesse caso não mexe no valor, só
// decripta quando há de fato uma string pra tratar.
export function decryptApiClientSecret<T extends { apiKey?: unknown }>(client: T): T {
  if (typeof client.apiKey !== 'string') return client
  return { ...client, apiKey: decryptSecretIfNeeded(client.apiKey) }
}

export function decryptInstanceSecrets<T extends { token?: unknown; webhookSecret?: unknown }>(
  instance: T,
): T {
  return {
    ...instance,
    ...(typeof instance.token === 'string' ? { token: decryptSecretIfNeeded(instance.token) } : {}),
    ...(typeof instance.webhookSecret === 'string'
      ? { webhookSecret: decryptSecretIfNeeded(instance.webhookSecret) }
      : {}),
  }
}
