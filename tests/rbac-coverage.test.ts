import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_ROUTE_RULES,
  getAllowedRolesForPathFromRules,
  canAccessPath,
} from '@/lib/rbac'

// Префиксы, которые middleware.ts пропускает без сессии — RBAC для них не действует.
// При изменении middleware обнови и этот список.
const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/cron',
  '/api/sync',
  '/api/matching',
  '/api/monitoring',
  '/api/stt',
  '/api/telphin',
  '/api/widget',
]

describe('rbac: разрешение по самому длинному префиксу', () => {
  it('страница и её API берут свои правила, а не родительские', () => {
    expect(getAllowedRolesForPathFromRules('/salary/my', DEFAULT_ROUTE_RULES)).toContain('manager')
    expect(getAllowedRolesForPathFromRules('/api/salary/my/report', DEFAULT_ROUTE_RULES)).toContain('manager')
    // а общий /salary — только admin/rop
    expect(getAllowedRolesForPathFromRules('/salary', DEFAULT_ROUTE_RULES)).not.toContain('manager')
    expect(getAllowedRolesForPathFromRules('/api/salary/report', DEFAULT_ROUTE_RULES)).not.toContain('manager')
  })

  it('/settings/profile доступен всем ролям, остальной /settings — только admin', () => {
    expect(canAccessPath('manager', '/settings/profile')).toBe(true)
    expect(canAccessPath('manager', '/settings/rules')).toBe(false)
  })
})

describe('rbac: дрейф страница ↔ API', () => {
  // Пары «страница → её API»: роли обязаны совпадать, иначе экран открывается, а данные 403.
  const pairs: Array<[string, string]> = [
    ['/okk', '/api/okk'],
    ['/okk/lead-catcher', '/api/lead-catcher'],
    ['/legal', '/api/legal'],
    ['/messenger', '/api/messenger'],
    ['/salary/my', '/api/salary/my'],
    ['/salary', '/api/salary'],
    ['/payments', '/api/payments'],
    ['/settings/prompts', '/api/settings/prompts'],
    ['/settings/access', '/api/settings/access'],
  ]

  it.each(pairs)('%s и %s имеют одинаковые роли', (page, api) => {
    const pageRoles = [...(getAllowedRolesForPathFromRules(page, DEFAULT_ROUTE_RULES) || [])].sort()
    const apiRoles = [...(getAllowedRolesForPathFromRules(api, DEFAULT_ROUTE_RULES) || [])].sort()
    expect(apiRoles).toEqual(pageRoles)
  })
})

describe('rbac: покрытие API-роутов правилами', () => {
  // Роуты, у которых нет своего правила и они падают в корневое '/' (admin/okk/rop).
  // Это осознанный baseline: НОВЫЙ роут сюда добавлять нельзя — заведи RouteRule в lib/rbac.ts.
  const KNOWN_FALLTHROUGH = [
    '/api/agents/status',
    '/api/ai/chat',
    '/api/ai/generate-rule',
    '/api/ai/route-orders',
    '/api/ai/train-route',
    '/api/calls/initiate',
    '/api/check-numbers',
    '/api/debug/match-log',
    '/api/debug/openai/status',
    '/api/debug/stt-config',
    '/api/debug/transcribe-check',
    '/api/faq/stats',
    '/api/faq/top',
    '/api/leads/catch',
    '/api/proxy/audio',
    '/api/system/activity',
    '/api/system/stats',
    '/api/system/transcription-details',
  ]

  function collectApiRoutes(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return collectApiRoutes(full)
      return e.name === 'route.ts' ? [dir] : []
    })
  }

  it('каждый защищённый API-роут имеет своё правило (или числится в baseline)', () => {
    const root = path.join(__dirname, '..')
    const routes = collectApiRoutes(path.join(root, 'app', 'api'))
      .map((p) => p.slice(path.join(root, 'app').length).replace(/\[[^\]]+\]/g, 'x'))
      .filter((r) => !PUBLIC_API_PREFIXES.some((p) => r.startsWith(p)))

    const fallthrough = routes
      .filter((r) => {
        const matches = DEFAULT_ROUTE_RULES
          .filter((rule) => r.startsWith(rule.prefix))
          .sort((a, b) => b.prefix.length - a.prefix.length)
        return !matches.length || matches[0].prefix === '/'
      })
      .sort()

    expect(fallthrough).toEqual([...KNOWN_FALLTHROUGH].sort())
  })
})
