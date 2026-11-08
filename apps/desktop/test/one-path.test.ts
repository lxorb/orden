import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('../src/lib/', import.meta.url))

const FILES = [
  'workspace.svelte.ts',
  ...readdirSync(join(LIB, 'workspace'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'moved.ts')
    .map((name) => `workspace/${name}`),
]

const PATH = String.raw`[\w$.?]*(?:[pP]ath|PATH|[rR]oot|[fF]older|\bdir)\b(?!\s*\()`

const COMPARED = new RegExp(String.raw`${PATH}\s*[!=]==\s*${PATH}`, 'g')
const PREFIXED = new RegExp(String.raw`${PATH}\??\.startsWith\(`, 'g')

function offenders(pattern: RegExp): string[] {
  const out: string[] = []

  for (const name of FILES) {
    const lines = readFileSync(join(LIB, name), 'utf8').split('\n')
    lines.forEach((line, at) => {
      const code = line.replace(/\/\/.*$/, '')
      if (/^\s*(\*|\/\*\*)/.test(code)) return
      if (pattern.test(code)) out.push(`${name}:${at + 1}: ${code.trim()}`)
      pattern.lastIndex = 0
    })
  }

  return out
}

describe('two space paths', () => {
  test('the scan reads the files it holds to', () => {
    expect(FILES.length).toBeGreaterThan(35)
  })

  test('are never compared with a bare === outside the helper', () => {
    expect(offenders(COMPARED)).toEqual([])
  })

  test('nor one found inside another by its first characters', () => {
    expect(offenders(PREFIXED)).toEqual([])
  })
})

const EVERY = readdirSync(LIB, { recursive: true, encoding: 'utf8' }).filter(
  (name) => /\.(?:ts|svelte)$/.test(name) && !name.endsWith('.test.ts'),
)

const LOOKED_UP = new RegExp(
  String.raw`\.(?:find|some|findIndex|filter|every)\(\((\w+)\) => \1\.(?:row\.)?root\s*[!=]==|activeSpace\?\.root\s*[!=]==(?!\s*(?:undefined|null))|[!=]==\s*[\w$.?()]*activeSpace\?\.root`,
)

describe('a space found by its folder', () => {
  test('the scan reads the whole app', () => {
    expect(EVERY.length).toBeGreaterThan(500)
  })

  test('is matched by path, never by the exact spelling of its root', () => {
    const out: string[] = []
    for (const name of EVERY) {
      readFileSync(join(LIB, name), 'utf8')
        .split('\n')
        .forEach((line, at) => {
          if (LOOKED_UP.test(line)) out.push(`${name}:${at + 1}: ${line.trim()}`)
        })
    }
    expect(out).toEqual([])
  })
})
