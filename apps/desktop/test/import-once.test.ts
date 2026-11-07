import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const EACH_TIME =
  /\b(?:watch|hear|hearSaves|hearIndexed|follow|subscribe)\((?:'[^']*',\s*)?\(?[\w\s,:]*\)?\s*=>(?![^\n]*\?\?=\s*import\()[^\n]*\bimport\(/

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((one) => {
    const path = join(folder, one.name)
    if (one.isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(one.name) && !one.name.includes('.test.') ? [path] : []
  })
}

describe('a module loaded from a listener', () => {
  test('is loaded once, not on every change heard, which in a large space is thousands of loads', () => {
    const found = sources(SRC).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, at) =>
          EACH_TIME.test(line) ? [`${path.slice(SRC.length)}:${String(at + 1)}`] : [],
        ),
    )
    expect(found).toEqual([])
  })
})
