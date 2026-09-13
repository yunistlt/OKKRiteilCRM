import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { UI_AUDIT_SCREENS } from '@/lib/ui-audit/screens'

/** Все app/**\/page.tsx → маршруты вида /a/[id]/b. Route-группы (name) пропускаются. */
function collectRoutes(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'api') continue
      const seg = entry.startsWith('(') ? '' : `/${entry}`
      out.push(...collectRoutes(full, prefix + seg))
    } else if (entry === 'page.tsx') {
      out.push(prefix || '/')
    }
  }
  return out
}

describe('реестр экранов режима тестировщика', () => {
  const routes = collectRoutes(path.resolve(__dirname, '../app'))
  const registered = new Set(UI_AUDIT_SCREENS.map((s) => s.route))

  it('каждый маршрут из app/ есть в реестре', () => {
    const missing = routes.filter((r) => !registered.has(r))
    expect(missing, `Добавьте в lib/ui-audit/screens.ts: ${missing.join(', ')}`).toEqual([])
  })

  it('в реестре нет несуществующих маршрутов', () => {
    const stale = Array.from(registered).filter((r) => !routes.includes(r))
    expect(stale, `Уберите из lib/ui-audit/screens.ts: ${stale.join(', ')}`).toEqual([])
  })

  it('ключи экранов уникальны', () => {
    const keys = UI_AUDIT_SCREENS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
