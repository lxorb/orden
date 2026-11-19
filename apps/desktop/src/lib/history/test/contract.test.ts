import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadHistory, RECOVERY_KEY } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
describe('the module stands on its own', () => {
  test('the api leaves the version list and the versions behind doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/^export \{[^}]*\} from '\.\/([A-Za-z.-]+)'/gm)].map((found) => found[1])
    expect(statics).toEqual(['recovery.svelte'])
    expect(typeof loadHistory).toBe('function')
    expect(RECOVERY_KEY).toBe('orden:recovery')
    expect(api).toMatch(/import\('\.\/History\.svelte'\)/)
    expect(api).toMatch(/import\('\.\/versions'\)/)
  })
})
