import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
describe('the module stands on its own', () => {
  test('the api names the one store and its item, and leaves finding doubles behind a door', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    expect(api.trim()).toBe("export { trash, type TrashItem } from './trash.svelte'")
    const store = readFileSync(join(SRC, 'trash.svelte.ts'), 'utf8')
    expect(store).toMatch(/await import\('\.\/doubles'\)/)
    expect(store).not.toMatch(/from '\.\/doubles'/)
  })
})
