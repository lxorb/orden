import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { walk } from './files'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const EACH_TIME =
  /\b(?:watch|hear|hearSaves|hearIndexed|follow|subscribe)\((?:'[^']*',\s*)?\(?[\w\s,:]*\)?\s*=>(?![^\n]*\?\?=\s*import\()[^\n]*\bimport\(/

describe('a module loaded from a listener', () => {
  test('is loaded once, not on every change heard, which in a large space is thousands of loads', () => {
    const found = walk(
      SRC,
      (path) => /\.(ts|svelte)$/.test(path) && !path.includes('.test.'),
    ).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, at) =>
          EACH_TIME.test(line) ? [`${path.slice(SRC.length)}:${String(at + 1)}`] : [],
        ),
    )
    expect(found).toEqual([])
  })
})
