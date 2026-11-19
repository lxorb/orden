import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { svelte, walk } from './files'
import { writeViewSpec } from '../src/lib/tab-kinds/src/api'
import { noteBehind } from '../src/lib/protect/src/protection.svelte'

const SOURCE = fileURLToPath(new URL('../src/lib/', import.meta.url))
describe('a tab shown over a protected note', () => {
  test('is the note itself, never a task view', () => {
    const view = (spec: Parameters<typeof writeViewSpec>[0]) => ({
      kind: 'view',
      path: null,
      doc: writeViewSpec(spec),
    })
    expect(noteBehind({ kind: 'note', path: '/space/Diary.md' })).toBe('/space/Diary.md')
    expect(noteBehind(view({ builtin: 'todos', space: 'Space' }))).toBeNull()
  })
  test('is locked by the note behind it, not by its own path alone', () => {
    const bare = walk(SOURCE, svelte)
      .filter((path) => /protection\.locked\(tab\??\.path\)/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    expect(bare).toEqual([])
  })
})
