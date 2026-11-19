import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(import.meta.dirname, '../../..')
const CONTRACT = readFileSync(join(ROOT, 'packages/contracts/src/surfaces.ts'), 'utf8')
const FEATURES = readFileSync(join(ROOT, 'apps/desktop/src/lib/features.ts'), 'utf8')
const ids = [...(/export type SurfaceId =([^=]*?)\n(?!\s*\|)/.exec(CONTRACT)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map(
  (one) => one[1] ?? '',
)
describe('every surface the shell draws', () => {
  test('is named in contracts', () => {
    expect(ids.length).toBeGreaterThan(30)
  })
  test.each(ids.map((id) => [id]))('%s is registered by the composition root', (id) => {
    const entry = new RegExp(`\\n\\s*'?${id}'?: (?!waits)`)
    expect(FEATURES).toMatch(entry)
  })
})
