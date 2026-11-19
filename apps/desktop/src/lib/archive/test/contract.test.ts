import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

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
  test('reaches no app module but the marks, the platform, the undo record, the tree, the ui kit and the workspace', () => {
    const reached = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map((found) => found[1]),
    )
    expect([...new Set(reached)].sort()).toEqual(['file-undo', 'marks', 'platform', 'tree', 'ui-kit', 'workspace'])
  })
})
describe('the archive of a space', () => {
  test('the api holds nothing statically and leaves the list and the archiving behind doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/^export \{[^}]*\} from '\.\/([A-Za-z.-]+)'/gm)].map((found) => found[1])
    expect(statics).toEqual([])
    expect(api).toMatch(/import\('\.\/Archive\.svelte'\)/)
    expect(api).toMatch(/import\('\.\/ArchivedStrip\.svelte'\)/)
    expect(api).toMatch(/import\('\.\/archiving'\)/)
  })
})
