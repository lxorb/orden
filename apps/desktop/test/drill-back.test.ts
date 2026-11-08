import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function views(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.svelte')) out.push(path)
    }
  }
  walk(SOURCE)
  return out
}

describe('a page opened inside another with a Back of its own', () => {
  test("is closed by a phone's Back too", () => {
    const drilled = views().filter((path) => /\sonback=\{/.test(readFileSync(path, 'utf8')))
    expect(drilled.length).toBeGreaterThan(0)
    const deaf = drilled
      .filter((path) => !readFileSync(path, 'utf8').includes('closeOnBack('))
      .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    expect(deaf).toEqual([])
  })
})
