import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { svelte, walk } from './files'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

describe('a page opened inside another with a Back of its own', () => {
  test("is closed by a phone's Back too", () => {
    const drilled = walk(SOURCE, svelte).filter((path) =>
      /\sonback=\{/.test(readFileSync(path, 'utf8')),
    )
    expect(drilled.length).toBeGreaterThan(0)
    const deaf = drilled
      .filter((path) => !readFileSync(path, 'utf8').includes('closeOnBack('))
      .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    expect(deaf).toEqual([])
  })
})
