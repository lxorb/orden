import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')
describe('a face', () => {
  test('is the one thing this module gives, so a view that shows a face carries no account sheet with it', () => {
    expect(readFileSync(join(SRC, 'api.ts'), 'utf8').trim()).toBe("export { default as Avatar } from './Avatar.svelte'")
  })
  test('reaches the account, the theme and the kit, and nothing that holds a workspace', () => {
    const reached = [
      ...readFileSync(join(SRC, 'Avatar.svelte'), 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g),
    ]
    expect([...new Set(reached.map((found) => found[1]))].sort()).toEqual(['accounts', 'theme', 'ui-kit'])
  })
})
