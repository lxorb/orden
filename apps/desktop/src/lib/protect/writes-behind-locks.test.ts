import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

const using = (pattern: RegExp) =>
  sources(SOURCE)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    .sort()

describe('the words of a note written by anything but its own editor', () => {
  test('go through the one edit that passes a shut protected note by', () => {
    expect(
      using(/import \{[^}]*\b(?:writeInTurn|writeEdited)\b[^}]*\} from '[^']*in-turn'/),
    ).toEqual([
      'link-index.svelte.ts',
      'workspace/note-text.ts',
      'workspace/undoing.ts',
      'workspace/write-file.ts',
    ])
  })

  test('and only a change made for every note alike may go through its lock', () => {
    expect(using(/throughLocks: true/)).toEqual([
      'workspace/own-keys-moved.ts',
      'workspace/setext.ts',
    ])
  })
})
