import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { code, walk } from './files'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PLACES = ['apps/desktop/src', 'packages']
const HELD_ONCE = /(?:\?\?|\|\|)=\s*import\(/
describe('a module loaded when first asked for', () => {
  test('goes through a door, which forgets a load that failed, never a promise kept for good', () => {
    const held = PLACES.flatMap((place) => walk(join(ROOT, place), code, ['node_modules', 'dist']))
      .filter((file) => HELD_ONCE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))
    expect(held).toEqual([])
  })
})
