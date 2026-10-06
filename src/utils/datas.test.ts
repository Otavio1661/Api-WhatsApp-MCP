// src/utils/datas.test.ts
import { describe, it, expect } from 'vitest'
import { formatarDataHora } from './datas'

describe('formatarDataHora', () => {
  it('converte UTC para o fuso de São Paulo (não mostra o horário UTC cru)', () => {
    // 2026-08-10T02:16:18Z == 23:16:18 do dia 09 em São Paulo (UTC-3).
    // O bug original mostrava "10/08/2026, 02:16:18" — data E hora erradas.
    const saida = formatarDataHora('2026-08-10T02:16:18.000Z')
    expect(saida).toContain('09/08/2026')
    expect(saida).toContain('23:16:18')
  })

  it('devolve travessão para valor ausente ou inválido', () => {
    expect(formatarDataHora(null)).toBe('—')
    expect(formatarDataHora(undefined)).toBe('—')
    expect(formatarDataHora('nao-e-data')).toBe('—')
  })
})
