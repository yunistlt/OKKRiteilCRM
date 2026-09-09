import { describe, it, expect } from 'vitest'
import {
  classifySystemJobRetryKind,
  getAdaptiveSystemJobRetry,
  calculateCallTranscriptionPriority,
} from '@/lib/system-jobs'

describe('classifySystemJobRetryKind', () => {
  it('распознаёт ожидание зависимости', () => {
    expect(classifySystemJobRetryKind('transcript not ready')).toBe('dependency_wait')
    expect(classifySystemJobRetryKind('waiting_transcription')).toBe('dependency_wait')
  })

  it('распознаёт rate limit', () => {
    expect(classifySystemJobRetryKind('HTTP 429 Too Many Requests')).toBe('rate_limit')
    expect(classifySystemJobRetryKind('rate limit exceeded')).toBe('rate_limit')
  })

  it('распознаёт сетевые ошибки', () => {
    expect(classifySystemJobRetryKind('fetch failed')).toBe('network')
    expect(classifySystemJobRetryKind('ECONNRESET')).toBe('network')
    expect(classifySystemJobRetryKind('upstream 503')).toBe('network')
    expect(classifySystemJobRetryKind('audio download failed')).toBe('network')
  })

  it('распознаёт ошибки AI', () => {
    expect(classifySystemJobRetryKind('openai error')).toBe('ai')
    expect(classifySystemJobRetryKind('whisper crashed')).toBe('ai')
  })

  it('по умолчанию generic', () => {
    expect(classifySystemJobRetryKind('something else')).toBe('generic')
    expect(classifySystemJobRetryKind(null)).toBe('generic')
    expect(classifySystemJobRetryKind(undefined)).toBe('generic')
  })
})

describe('getAdaptiveSystemJobRetry', () => {
  it('generic fast: растущий backoff с потолком', () => {
    expect(getAdaptiveSystemJobRetry({ attempts: 1 }).retryDelaySeconds).toBe(30)
    expect(getAdaptiveSystemJobRetry({ attempts: 2 }).retryDelaySeconds).toBe(120)
    expect(getAdaptiveSystemJobRetry({ attempts: 4 }).retryDelaySeconds).toBe(900)
    // за пределами таблицы — держим последний (потолок), не падаем
    expect(getAdaptiveSystemJobRetry({ attempts: 99 }).retryDelaySeconds).toBe(900)
  })

  it('attempts=0/отрицательное нормализуется к первой ступени', () => {
    expect(getAdaptiveSystemJobRetry({ attempts: 0 }).retryDelaySeconds).toBe(30)
    expect(getAdaptiveSystemJobRetry({ attempts: -5 }).retryDelaySeconds).toBe(30)
  })

  it('rate_limit ждёт дольше generic, dependency_wait — короче', () => {
    const generic = getAdaptiveSystemJobRetry({ attempts: 1, errorMessage: 'boom' })
    const rate = getAdaptiveSystemJobRetry({ attempts: 1, errorMessage: '429' })
    const dep = getAdaptiveSystemJobRetry({ attempts: 1, errorMessage: 'not ready' })
    expect(rate.retryDelaySeconds).toBeGreaterThan(generic.retryDelaySeconds)
    expect(dep.retryDelaySeconds).toBeLessThan(generic.retryDelaySeconds)
    expect(rate.retryKind).toBe('rate_limit')
    expect(dep.retryKind).toBe('dependency_wait')
  })

  it('slow-профиль ждёт дольше fast', () => {
    const fast = getAdaptiveSystemJobRetry({ attempts: 2, errorMessage: 'timeout' })
    const slow = getAdaptiveSystemJobRetry({ attempts: 2, errorMessage: 'timeout', profile: 'slow' })
    expect(slow.retryDelaySeconds).toBeGreaterThan(fast.retryDelaySeconds)
  })
})

describe('calculateCallTranscriptionPriority', () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString()

  it('свежие звонки приоритетнее старых (меньше = раньше)', () => {
    expect(calculateCallTranscriptionPriority({ startedAt: minutesAgo(5) })).toBe(6)
    expect(calculateCallTranscriptionPriority({ startedAt: minutesAgo(30) })).toBe(8)
    expect(calculateCallTranscriptionPriority({ startedAt: minutesAgo(120) })).toBe(12)
    expect(calculateCallTranscriptionPriority({ startedAt: minutesAgo(60 * 24) })).toBe(18)
  })

  it('без даты — низкий приоритет по умолчанию', () => {
    expect(calculateCallTranscriptionPriority({})).toBe(18)
  })

  it('совпадение с рабочим заказом поднимает приоритет, но не ниже 1', () => {
    expect(calculateCallTranscriptionPriority({ startedAt: minutesAgo(5), hasWorkingOrderMatch: true })).toBe(2)
    expect(calculateCallTranscriptionPriority({ hasWorkingOrderMatch: true })).toBe(14)
  })
})
