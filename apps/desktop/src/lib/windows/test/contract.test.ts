import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const { heightOf, indexAt, listHeight, windowDocuments, windowFor } = await import('../src/api')

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('no file under src imports anything of the app', () => {
    const reaching = readdirSync(SRC)
      .filter((name) => /\.(ts|svelte)$/.test(name) && !name.includes('.test.'))
      .flatMap((name) =>
        [...readFileSync(join(SRC, name), 'utf8').matchAll(/(?:from |import\()'([^']*)'/g)]
          .map((found) => found[1] ?? '')
          .filter(
            (specifier) => !specifier.startsWith('./') && !specifier.startsWith('@tauri-apps/'),
          )
          .map((specifier) => `${name}: ${specifier}`),
      )
    expect(reaching).toEqual([])
  })
})

describe('a window of rows', () => {
  const rows = { count: 100, height: 20, top: 400, room: 200, overscan: 2 }

  test('measures the list and finds the row under a point', () => {
    expect(listHeight(rows)).toBe(2000)
    expect(heightOf(3, rows)).toBe(20)
    expect(indexAt(45, rows)).toBe(2)
  })

  test('draws only the rows in view, with the overscan either side', () => {
    const shown = windowFor(rows)
    expect([shown.first, shown.last]).toEqual([18, 31])
    expect(shown.above).toBe(360)
    expect(shown.below).toBe(2000 - 32 * 20)
  })
})

describe('the document a window shows', () => {
  test('is the app with nothing open, and the note with its path on a Mac', async () => {
    const { windowDocument } = await windowDocuments()
    expect(windowDocument(null, true)).toEqual({ title: 'Orden', edited: false, path: null })
    expect(windowDocument({ shown: 'Plan', path: '/n/Plan.md', draft: true }, true)).toEqual({
      title: 'Plan',
      edited: true,
      path: '/n/Plan.md',
    })
    expect(windowDocument({ shown: 'Plan', path: '/n/Plan.md' }, false).title).toBe('Plan - Orden')
  })
})
