import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseCombination } from '../../ui-kit/src/keys'
import { LAYOUTS, letterUnder, pressOn, readsLayout } from '../../ui-kit/test/layouts'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const { shortcuts, SHORTCUTS } = await import('./shortcuts.svelte')
const PLATFORMS = ['win', 'linux', 'mac'] as const
const onPlatform = (platform: string) => {
  const one = Object.create(shortcuts) as typeof shortcuts
  Object.defineProperty(one, 'platform', { value: platform })
  return one
}
afterEach(async () => {
  await readsLayout(null, vi.stubGlobal)
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', memoryStorage())
})
describe.each(Object.keys(LAYOUTS))('on the %s layout', (name) => {
  const layout = LAYOUTS[name] ?? {}
  const codes = Object.keys(layout)
  test.each(PLATFORMS)('every letter shortcut answers the one key that writes its letter (%s)', async (platform) => {
    await readsLayout(layout, vi.stubGlobal)
    const one = onPlatform(platform)
    for (const entry of SHORTCUTS) {
      if (entry.scope === 'fixed') continue
      const combination = parseCombination(one.keyFor(entry.id) ?? '', platform)
      if (!combination || !/^[a-z]$/.test(combination.key)) continue
      const { ctrl, meta, alt, shift } = combination
      if (!ctrl && !meta && !alt) continue
      const held = { ctrl, meta, alt, shift }
      const answered = codes.filter((code) => one.pressed(entry.id, pressOn(layout, code, held)))
      const writing = codes.filter((code) => letterUnder(layout, code) === combination.key)
      expect(answered, `${platform} ${entry.id}`).toEqual(writing)
      expect(answered.length, `${platform} ${entry.id}`).toBe(1)
    }
  })
})
const DESKTOP = join(import.meta.dirname, '../../../..')
const PACKAGES = join(DESKTOP, '../../packages')
const KEEPS_THE_TABLE = new Set(['src/lib/ui-kit/src/keys.ts'])
const BY_CODE = [
  /\.code\b[^\n;]{0,40}(?:===|!==|==|!=)\s*['"`]Key[A-Z]/,
  /['"`]Key[A-Z]['"`]\s*(?:===|!==|==|!=)/,
  /\/\^?Key\[A-Z\]/,
  /\.code\??\.startsWith\(\s*['"`]Key/,
  /PHYSICAL\[[^\]]*code/,
]
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'test' || name.startsWith('.')) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name) ? [path] : []
  })
}
describe('the keyboard handlers', () => {
  test('never tell a letter by the physical key it sits on', () => {
    const files = [
      ...sources(join(DESKTOP, 'src')),
      ...readdirSync(PACKAGES).flatMap((one) => {
        const src = join(PACKAGES, one, 'src')
        try {
          return sources(src)
        } catch {
          return []
        }
      }),
    ]
    expect(files.length).toBeGreaterThan(500)
    const found = files.flatMap((path) => {
      const where = relative(DESKTOP, path)
      if (KEEPS_THE_TABLE.has(where)) return []
      return readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, at) => (BY_CODE.some((rule) => rule.test(line)) ? [`${where}:${at + 1}: ${line.trim()}`] : []))
    })
    expect(found).toEqual([])
  })
})
