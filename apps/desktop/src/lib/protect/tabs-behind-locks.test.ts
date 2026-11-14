import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { writeSpec } from '../views/spec'
import { noteBehind } from './protection.svelte'

const SOURCE = fileURLToPath(new URL('..', import.meta.url))

function views(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return views(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

describe('a tab shown over a protected note', () => {
  test('is the note itself, never a task view', () => {
    const view = (spec: Parameters<typeof writeSpec>[0]) => ({
      kind: 'view',
      path: null,
      doc: writeSpec(spec),
    })
    expect(noteBehind({ kind: 'note', path: '/space/Diary.md' })).toBe('/space/Diary.md')
    expect(noteBehind(view({ builtin: 'todos', space: 'Space' }))).toBeNull()
  })

  test('is locked by the note behind it, not by its own path alone', () => {
    const bare = views(SOURCE)
      .filter((path) => /protection\.locked\(tab\??\.path\)/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    expect(bare).toEqual([])
  })
})
