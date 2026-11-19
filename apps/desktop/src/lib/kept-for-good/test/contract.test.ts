import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { keptForGood } from '../src/api'

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
  test('reaches no app module but the platform', () => {
    const reached = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map((found) => found[1]),
    )
    expect([...new Set(reached)].sort()).toEqual(['platform'])
  })
})
describe('asking the browser to keep what is here', () => {
  test('with no browser storage to ask, nothing is asked and nothing is held', async () => {
    expect(keptForGood.able).toBe(false)
    await keptForGood.ask()
    await keptForGood.again()
    expect(keptForGood.held).toBeNull()
  })
})
