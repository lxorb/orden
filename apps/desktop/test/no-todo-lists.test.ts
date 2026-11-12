import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const GONE = ['isTodoList', 'Use as todo list', 'todo_list', 'makeList', 'unmakeList', 'LIST_KEY']

const SAYING = ['apps/desktop/test/no-todo-lists.test.ts', 'apps/desktop/src/lib/rows/unlisted.ts']

const TEXT = /\.(ts|svelte|rs|json|py|md|mjs|js|yml|yaml|toml)$/

test('no note is a todo list: the mark, its menu entry and its tool argument stay gone (#2103)', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((path) => TEXT.test(path) && !SAYING.includes(path))
  const found: string[] = []
  for (const path of files) {
    const text = readFileSync(join(ROOT, path), 'utf8')
    for (const word of GONE) if (text.includes(word)) found.push(`${path}: ${word}`)
  }
  expect(found).toEqual([])
})
