import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { syncedCopies } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}
describe('the module stands on its own', () => {
  test('reaches only the modules it names', () => {
    const reached = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map((found) => found[1]),
    )
    expect([...new Set(reached)].sort()).toEqual(['accounts', 'platform', 'sync-client', 'sync-mirror', 'ui-kit'])
  })
})
describe('the conflict copies a sync left behind', () => {
  test('an engine that keeps no tree has none to count or take away', async () => {
    const engine = { copies: undefined } as unknown as Parameters<typeof syncedCopies>[0]
    const copies = syncedCopies(engine)
    expect(copies.count).toBe(0)
    await expect(copies.remove()).resolves.toBeUndefined()
  })
})
