import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What the editor loads in order to show a note at all.
 *
 *  `isDeck` is asked about every note a pane opens - it decides whether the deck
 *  affordances are there - and it answers by scanning lines for rules. It used to
 *  be reached through a module that imported the markdown package's entry point
 *  for its lexer, so opening any note pulled in the renderer, KaTeX, KaTeX's
 *  chemistry pack and the emoji table: about a megabyte of bundle, none of which a
 *  line scan uses. Checked here rather than remembered, because nothing about that
 *  import looked expensive from the editor's side. */

const MARKDOWN = fileURLToPath(new URL('../../markdown/src/', import.meta.url))

/** Every module reached from a file, and every package any of them asks for.
 *
 *  Read off the source rather than out of a bundle, so the answer is the same
 *  whichever bundler the app is built with and needs no build to ask. */
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
  test('the deck reader is four modules and the markdown lexer', () => {
    const { files, packages } = graphOf(resolve(MARKDOWN, 'slides.ts'))

    expect([...packages].sort()).toEqual(['marked'])
    expect(names(files)).toEqual(['blocks.ts', 'fences.ts', 'slides.ts', 'starts.ts'])
  })

  test('and no formula engine, no chemistry pack and no emoji table', () => {
    const { packages } = graphOf(resolve(MARKDOWN, 'slides.ts'))

    for (const heavy of ['katex', 'katex/contrib/mhchem', 'node-emoji']) {
      expect(packages, heavy).not.toContain(heavy)
    }
  })

  test('which the renderer itself still has, since drawing a note needs them', () => {
    const { packages } = graphOf(resolve(MARKDOWN, 'index.ts'))

    expect(packages).toContain('katex')
    expect(packages).toContain('node-emoji')
  })
})
