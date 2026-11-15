import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type FileAction, FileActions, joinLast } from '../src/api'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('reaches no app module but the platform and the file ops', () => {
    const reached = readdirSync(SRC)
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
      .flatMap((name) =>
        [...readFileSync(join(SRC, name), 'utf8').matchAll(/from '(\.\.[^']*)'/g)].map(
          (found) => found[1],
        ),
      )
    expect([...new Set(reached)].sort()).toEqual([
      '../../file-ops/src/api',
      '../../platform/src/api',
    ])
  })
})

describe('the record of what can be undone', () => {
  test('keeps the last twenty steps, and a new step forgets what could be redone', () => {
    const undone = new FileActions()
    for (let one = 0; one < 25; one += 1) undone.record({ kind: 'create', path: `/s/${one}.md` })
    expect(undone.stack).toHaveLength(20)
    undone.drop()
    expect(undone.next).toEqual({ kind: 'create', path: '/s/24.md' })
    undone.record({ kind: 'create', path: '/s/new.md' })
    expect(undone.next).toBeUndefined()
  })

  test('a batch is one step, and the record waits for it to land', async () => {
    const undone = new FileActions()
    const { landed } = await undone.batch(async () => {
      undone.record({ kind: 'create', path: '/s/A.md' })
      undone.record({ kind: 'create', path: '/s/B.md' })
      return { landed: undone.landed() }
    })
    expect(await landed).toBe(true)
    expect(undone.stack).toHaveLength(1)
    expect(undone.last?.kind).toBe('many')
  })

  test('a moved file is followed by the steps that name it', async () => {
    const undone = new FileActions()
    undone.record({ kind: 'create', path: '/s/A.md' })
    await undone.moved('/s/A.md', '/s/B.md')
    expect(undone.last).toEqual({ kind: 'create', path: '/s/B.md' })
  })

  test('two edits of the same words in a row join into one step', async () => {
    const undone = new FileActions()
    const replace = (content: string, after: string): FileAction => ({
      kind: 'replace',
      notes: [{ path: '/s/A.md', content, after, edits: [] }],
    })
    undone.record(replace('one', 'two'))
    undone.record(replace('two', 'three'))
    expect(await joinLast(undone)).toBe(true)
    expect(undone.stack).toHaveLength(1)
    expect(undone.last?.kind === 'replace' && undone.last.notes[0]?.after).toBe('three')
  })
})
