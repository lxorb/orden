import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const PLACES = ['apps/desktop/src', 'packages']

const HELD_ONCE = /(?:\?\?|\|\|)=\s*import\(/

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sources(path, found)
    else if (/\.(?:ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts'))
      found.push(path)
  }
  return found
}

describe('a module loaded when first asked for', () => {
  test('goes through a door, which forgets a load that failed, never a promise kept for good', () => {
    const held = PLACES.flatMap((place) => sources(join(ROOT, place)))
      .filter((file) => HELD_ONCE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))
    expect(held).toEqual([])
  })
})
