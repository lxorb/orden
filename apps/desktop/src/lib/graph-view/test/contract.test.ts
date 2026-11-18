import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadGraph } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')

describe('the module stands on its own', () => {
  test('the api leaves the drawn graph behind its door', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/^export \{[^}]*\} from '\.\/([A-Za-z.-]+)'/gm)].map(
      (found) => found[1],
    )
    expect(statics).toEqual([])
    expect(api).toMatch(/import\('\.\/Graph\.svelte'\)/)
    expect(typeof loadGraph).toBe('function')
  })
})
