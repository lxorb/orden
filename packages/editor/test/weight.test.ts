import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const MARKDOWN = fileURLToPath(new URL('../../markdown/src/', import.meta.url))

const DOOR = join(import.meta.dirname, '../../lang-html/src/index.ts')

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
  test('no formula engine, no chemistry pack and no emoji table: the renderer asks for them', () => {
    const { packages, files } = graphOf(resolve(MARKDOWN, 'index.ts'))

    for (const heavy of ['katex', 'katex/contrib/mhchem', 'node-emoji']) {
      expect(packages, heavy).not.toContain(heavy)
    }
    expect(names(files)).toContain('engines.ts')
  })

  test('and the one module that does import them is not reached from the renderer', () => {
    const { files } = graphOf(resolve(MARKDOWN, 'index.ts'))

    expect(names(files)).not.toContain('maths.ts')
    expect(names(files)).not.toContain('eager.ts')
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
