import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  boxOf,
  citation,
  handed,
  matrixOf,
  paperText,
  papers,
  PDF_TO_CSS,
  placesOnPaper,
  readPapers,
  runsOfItems,
  sheetFor,
  textOfRuns,
  toViewport,
} from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('the api loads with no paper read and every door closed', () => {
    for (const one of [papers, handed, readPapers, paperText]) {
      expect(typeof one).toBe('function')
    }
  })
})

describe('the words on a paper', () => {
  test('a run that ends its line gets its line break, and the runs join into the text', () => {
    const runs = runsOfItems([
      { str: 'Entropy is', hasEOL: true },
      { str: 'a measure' },
      { width: 4 },
    ])
    expect(runs).toEqual(['Entropy is\n', 'a measure'])
    expect(textOfRuns(runs)).toBe('Entropy is\na measure')
  })

  test('a word broken over two lines by a hyphen is found whole, over the whole span', () => {
    const text = 'the infor-\nmation flows'
    expect(placesOnPaper(text, 'information')).toEqual([{ at: 4, length: 13 }])
    expect(placesOnPaper(text, 'entropy')).toEqual([])
  })
})

describe('where a highlight sits and how it is quoted', () => {
  test('a quad lands as the box around its corners on the page as drawn', () => {
    const quad = [10, 20, 30, 20, 30, 5, 10, 5] as const
    expect(boxOf(quad, toViewport(matrixOf([2, 0, 0, 2, 1, 1])))).toEqual({
      left: 21,
      top: 11,
      width: 40,
      height: 30,
    })
  })

  test('a missing matrix value falls back to the identity', () => {
    expect(matrixOf([])).toEqual([1, 0, 0, 1, 0, 0])
  })

  test('a citation quotes every line and links to its page', () => {
    const quoted = citation('Paper.pdf', 3, ' first\nsecond ')
    expect(quoted.startsWith('> first\n> second\n\n')).toBe(true)
    expect(quoted).toContain('page=3')
    expect(citation('Paper.pdf', 3, '   ').startsWith('>')).toBe(false)
  })
})

describe('the size a page is drawn at', () => {
  test('a point is a third larger in CSS pixels', () => {
    expect(PDF_TO_CSS).toBeCloseTo(4 / 3)
  })

  test('a page is drawn sharper up to the screen ratio, and never past the pixel cap', () => {
    expect(sheetFor({ width: 100, height: 100 }, 1_000_000, 2)).toEqual({
      width: 200,
      height: 200,
      drawn: { transform: [2, 0, 0, 2, 0, 0] },
    })
    expect(sheetFor({ width: 100, height: 100 }, 10_000, 2)).toEqual({
      width: 100,
      height: 100,
      drawn: {},
    })
  })
})
