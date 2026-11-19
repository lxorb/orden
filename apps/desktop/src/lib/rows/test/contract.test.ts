import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { noteRowsOf } from '../src/store'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
test('the module stands on its own names the rows store, what a row is read from and how one is written', () => {
  const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
  for (const name of ['rows', 'noteRowsOf', 'changed', 'RowChange']) {
    expect(api).toMatch(new RegExp(`\\b${name}\\b`))
  }
})
describe('the rows of a note', () => {
  test('are the note and each of its tasks, anchored to their lines', () => {
    const found = noteRowsOf('s', 'Plan.md', '# Plan\n\n- [ ] call Ada\n- [x] book the room\n')
    expect(found.map((one) => [one.kind, one.space, one.path])).toEqual([
      ['note', 's', 'Plan.md'],
      ['task', 's', 'Plan.md'],
      ['task', 's', 'Plan.md'],
    ])
    expect(found.filter((one) => one.kind === 'task').map((one) => one.anchor?.line)).toEqual([2, 3])
  })
  test('are only the note when it holds no task', () => {
    expect(noteRowsOf('s', 'Notes/Idea.md', 'words').map((one) => one.kind)).toEqual(['note'])
  })
})
