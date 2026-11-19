import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { walk } from './files'

const LIB = join(import.meta.dirname, '..', 'src', 'lib')
describe('trouble a feature runs into', () => {
  test('is said as a notice, never left in a settings window that is usually shut', () => {
    const hidden = walk(LIB, (path) => /\.(?:ts|svelte)$/.test(path) && !path.includes('.test.'))
      .filter((file) => /settingsWindow\(\)\.error\s*=/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(LIB, file))
    expect(hidden).toEqual([])
  })
})
