import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const LIB = join(import.meta.dirname, '..', 'src', 'lib')

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sources(path, found)
    else if (/\.(?:ts|svelte)$/.test(entry.name) && !entry.name.includes('.test.')) found.push(path)
  }
  return found
}

describe('trouble a feature runs into', () => {
  test('is said as a notice, never left in a settings window that is usually shut', () => {
    const hidden = sources(LIB)
      .filter((file) => /settingsWindow\(\)\.error\s*=/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(LIB, file))
    expect(hidden).toEqual([])
  })
})
