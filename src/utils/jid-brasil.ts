// src/utils/jid-brasil.ts
//
// Resolução do destinatário real no WhatsApp — nasceu do "nono dígito"
// brasileiro, mas resolve o problema de forma geral.
//
// CONTEXTO: números de celular no Brasil ganharam um 9 na frente
// (44 7777-0013 → 44 97777-0013). O WhatsApp, porém, mantém a conta no
// formato com que ela foi REGISTRADA — contas antigas seguem valendo sem o 9.
// Quem envia normalmente digita o formato novo (com 9), que é o padrão em
// qualquer cadastro hoje. Se a conta é antiga, esse número com 9 simplesmente
// não existe como JID: o whatsmeow aceita, devolve um ID de mensagem e a
// mensagem some — nenhum erro em lugar nenhum (foi exatamente o que
// aconteceu, 2026-08-10). O contrário também acontece: cadastro antigo sem o
// 9 mandando pra uma conta nova, que só existe com o 9.
//
// SOLUÇÃO: em vez de adivinhar a regra (que varia por DDD, por época de
// registro e muda com o tempo), perguntamos ao próprio WhatsApp qual é o JID
// real via /user/check e usamos a resposta. Assim os DOIS formatos entram e
// ambos chegam ao mesmo lugar, sem tabela de DDD pra manter.
import { redis } from './redis'
import { logger } from './logger'

// O JID resolvido é estável (só muda se a pessoa trocar de conta), mas não é
// eterno — 7 dias evita uma ida ao WhatsApp por mensagem sem petrificar o
// resultado. Cache por número, não por instância: o JID de um número é o
// mesmo pra qualquer sessão que pergunte.
const TTL_CACHE_SEGUNDOS = 7 * 24 * 60 * 60

function chaveCache(telefone: string): string {
  return `jid:${telefone}`
}

/**
 * `to` já é um JID/destino que não deve ser mexido? Grupos (@g.us),
 * newsletters, LIDs e qualquer coisa já endereçada passam direto — só número
 * de telefone cru precisa de resolução.
 */
export function ehDestinoLiteral(to: string): boolean {
  return to.includes('@')
}

export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

/** Extrai a parte de telefone de um JID ("554477770013@s.whatsapp.net" → "554477770013"). */
export function telefoneDoJid(jid: string): string {
  return apenasDigitos(jid.split('@')[0].split(':')[0])
}

export interface ResolucaoDestino {
  /** Telefone a usar no envio (já no formato que o WhatsApp reconhece). */
  telefone: string
  /** false = número não tem WhatsApp; o envio deve falhar explicitamente. */
  existeNoWhatsapp: boolean
  /** true quando a resposta veio do cache (só para log/teste). */
  doCache: boolean
}

/**
 * Descobre o telefone realmente endereçável no WhatsApp.
 *
 * `consultar` é injetado (o provider passa seu próprio checkNumber) pra este
 * módulo não depender do provider — mantém a regra testável sem rede.
 *
 * Falha na consulta NÃO bloqueia o envio: cai no número original e deixa o
 * WhatsApp decidir. Perder a normalização é ruim, mas derrubar todo envio
 * porque o /user/check está fora do ar seria pior.
 */
export async function resolverDestino(
  to: string,
  consultar: (telefones: string[]) => Promise<Array<{ phone: string; existsOnWhatsapp: boolean; jid?: string }>>,
): Promise<ResolucaoDestino> {
  if (ehDestinoLiteral(to)) {
    return { telefone: to, existeNoWhatsapp: true, doCache: false }
  }

  const original = apenasDigitos(to)
  if (!original) return { telefone: to, existeNoWhatsapp: true, doCache: false }

  try {
    const emCache = await redis.get(chaveCache(original))
    if (emCache) {
      // "-" marca "checado e não tem WhatsApp" — distinto de ausência de cache.
      if (emCache === '-') return { telefone: original, existeNoWhatsapp: false, doCache: true }
      return { telefone: emCache, existeNoWhatsapp: true, doCache: true }
    }
  } catch (err: any) {
    logger.warn(`[JID] Cache indisponível para ${original}: ${err.message}`)
  }

  let resolvido = original
  let existe = true
  try {
    const [resultado] = await consultar([original])
    if (resultado) {
      existe = resultado.existsOnWhatsapp
      if (existe && resultado.jid) {
        const telefone = telefoneDoJid(resultado.jid)
        if (telefone) resolvido = telefone
      }
    }

    try {
      await redis.set(chaveCache(original), existe ? resolvido : '-', 'EX', TTL_CACHE_SEGUNDOS)
    } catch {
      /* cache é otimização; falhar aqui não afeta o envio */
    }

    if (existe && resolvido !== original) {
      logger.info(`[JID] ${original} → ${resolvido} (formato real no WhatsApp)`)
    }
  } catch (err: any) {
    // Não sabemos se existe; segue com o original em vez de bloquear o envio.
    logger.warn(`[JID] Falha ao resolver ${original}, usando como veio: ${err.message}`)
    return { telefone: original, existeNoWhatsapp: true, doCache: false }
  }

  return { telefone: resolvido, existeNoWhatsapp: existe, doCache: false }
}
