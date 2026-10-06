// src/utils/datas.ts
// Formatação de data/hora para o painel server-rendered.
//
// O container roda com TZ=UTC (padrão da imagem). `toLocaleString('pt-BR')`
// sozinho define só o LOCALE (dd/mm/aaaa), não o fuso — então as telas
// mostravam o horário UTC com cara de brasileiro, 3h adiantado (um envio das
// 23:16 aparecia como 02:16 do dia seguinte, inclusive virando a data).
//
// Fixamos o fuso na formatação em vez de mudar o TZ do container de propósito:
// mexer no TZ do processo moveria junto a meia-noite do reset de contadores
// diários (scheduler, '0 0 * * *') e a interpretação dos campos
// `timestamp without time zone` pelo Prisma — efeitos bem além de exibição.
export const FUSO_PAINEL = 'America/Sao_Paulo'

export function formatarDataHora(valor: Date | string | null | undefined): string {
  if (!valor) return '—'
  const data = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(data.getTime())) return '—'
  return data.toLocaleString('pt-BR', { timeZone: FUSO_PAINEL })
}
