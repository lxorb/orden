import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
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
  test('nothing under src stores a secret in the browser', () => {
    const storing = sources(SRC).filter((file) =>
      /\b(?:localStorage|sessionStorage|indexedDB)\b/.test(readFileSync(file, 'utf8')),
    )
    expect(storing.map((file) => relative(SRC, file))).toEqual([])
  })
})
