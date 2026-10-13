import { describe, it, expect } from 'vitest'
import { conditionsMet, type GateRow } from '@/lib/read-gate/service'
import { requiredSeconds, READ_GATE_DEFAULTS } from '@/lib/read-gate/settings'

const row = (over: Partial<GateRow> = {}): GateRow => ({
  id: 1,
  doc_kind: 'call_review',
  doc_ref: '1',
  user_id: 'u',
  required_seconds: 45,
  opened_at: null,
  visible_seconds: 0,
  scrolled_to_end: false,
  confirmed_at: null,
  deferred_at: null,
  defer_reason: null,
  defer_until: null,
  last_beat_at: null,
  ...over,
})

describe('шлюз чтения: условия разблокировки', () => {
  it('нужны оба условия сразу', () => {
    expect(conditionsMet(row({ visible_seconds: 60, scrolled_to_end: false }))).toBe(false)
    expect(conditionsMet(row({ visible_seconds: 10, scrolled_to_end: true }))).toBe(false)
    expect(conditionsMet(row({ visible_seconds: 45, scrolled_to_end: true }))).toBe(true)
  })

  it('секунда до порога — ещё нельзя', () => {
    expect(conditionsMet(row({ visible_seconds: 44, scrolled_to_end: true }))).toBe(false)
  })
})

describe('шлюз чтения: сколько времени требовать', () => {
  it('короткий документ — минимум, не меньше', () => {
    expect(requiredSeconds(10, READ_GATE_DEFAULTS)).toBe(45)
    expect(requiredSeconds(0, READ_GATE_DEFAULTS)).toBe(45)
  })

  it('длинный документ — по объёму текста, но не дольше потолка', () => {
    // 3000 знаков при 15 знаках в секунду — 200 секунд, потолок 60.
    expect(requiredSeconds(3000, READ_GATE_DEFAULTS)).toBe(60)
    expect(requiredSeconds(3000, { ...READ_GATE_DEFAULTS, maxSeconds: 0 })).toBe(200)
  })

  it('потолок ниже минимума не опускает планку ниже минимума', () => {
    expect(requiredSeconds(3000, { ...READ_GATE_DEFAULTS, maxSeconds: 10 })).toBe(45)
  })

  it('порог из настроек, а не из кода', () => {
    const settings = { ...READ_GATE_DEFAULTS, minSeconds: 90, charsPerSecond: 30, maxSeconds: 0 }
    expect(requiredSeconds(100, settings)).toBe(90)
    expect(requiredSeconds(6000, settings)).toBe(200)
  })
})
