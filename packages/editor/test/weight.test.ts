import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const MARKDOWN = fileURLToPath(new URL('../../markdown/src/', import.meta.url))

const DOOR = fileURLToPath(new URL('../../lang-html/src/index.ts', import.meta.url))

function graphOf(entry: string): { files: string[]; packages: Set<string> } {
  const files: string[] = []
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length) {
    const file = queue.shift()
    if (file === undefined || files.includes(file)) continue
    files.push(file)

    const source = readFileSync(file, 'utf8')
    for (const found of source.matchAll(/(?:from|import)\s*'([^']+)'/g)) {
      const asked = found[1] ?? ''
      if (asked.startsWith('.')) queue.push(resolve(dirname(file), `${asked}.ts`))
      else packages.add(asked)
    }
  }

  return { files, packages }
}

const names = (files: readonly string[]) =>
  files.map((one) => one.split(/[\\/]/).pop() ?? one).sort()

describe('what showing a note loads', () => {
  test('the deck reader is six modules and the markdown lexer', () => {
    const { files, packages } = graphOf(resolve(MARKDOWN, 'slides.ts'))

    expect([...packages].sort()).toEqual(['marked'])
    expect(names(files)).toEqual([
      'blocks.ts',
      'fences.ts',
      'front-matter-lines.ts',
      'slide-breaks.ts',
      'slides.ts',
      'starts.ts',
    ])
  })

  test('while whether a note is a deck is a line scan and no lexer', () => {
    const { files, packages } = graphOf(resolve(MARKDOWN, 'slide-breaks.ts'))

    expect([...packages]).toEqual([])
    expect(names(files)).toEqual(['fences.ts', 'front-matter-lines.ts', 'slide-breaks.ts'])
  })

  test('and no formula engine, no chemistry pack and no emoji table', () => {
    const { packages } = graphOf(resolve(MARKDOWN, 'slides.ts'))

    for (const heavy of ['katex', 'katex/contrib/mhchem', 'node-emoji']) {
      expect(packages, heavy).not.toContain(heavy)
    }
  })

  test('and the renderer asks for them rather than importing them', () => {
    const { packages, files } = graphOf(resolve(MARKDOWN, 'index.ts'))

    for (const heavy of ['katex', 'katex/contrib/mhchem', 'node-emoji']) {
      expect(packages, heavy).not.toContain(heavy)
    }
    expect(names(files)).toContain('engines.ts')
  })

  test('and the one module that does import them is not reached from either', () => {
    for (const entry of ['index.ts', 'slides.ts']) {
      const { files } = graphOf(resolve(MARKDOWN, entry))

      expect(names(files), entry).not.toContain('maths.ts')
      expect(names(files), entry).not.toContain('eager.ts')
    }
  })

  test('and the HTML grammar is a door, not an import', () => {
    const { files, packages } = graphOf(DOOR)

    expect(names(files)).toEqual(['index.ts'])
    expect(packages).not.toContain('@codemirror/lang-html')
    expect([...packages].sort()).toEqual([
      '@codemirror/autocomplete',
      '@codemirror/language',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/common',
    ])
  })

  test('while the eager pair still holds both, for the Worker that has no wait', () => {
    const { packages } = graphOf(resolve(MARKDOWN, 'eager.ts'))

    expect(packages).toContain('katex')
    expect(packages).toContain('katex/contrib/mhchem')
    expect(packages).toContain('node-emoji')
  })
})
