import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FileAction } from '../workspace/undo.svelte'

const asked: string[] = []
const ok = (pairs: { from: string; to: string }[]) => ({
  done: pairs,
  replaced: [],
  skipped: [],
  failed: [],
  cancelled: false,
})
vi.mock('./commands', () => ({
  put: (_job: string, pairs: { from: string; to: string }[], how: string) => {
    asked.push(`${how} ${pairs.map((one) => `${one.from}>${one.to}`).join(',')}`)
    return Promise.resolve(ok(pairs))
  },
  trashPaths: (paths: string[]) => {
    asked.push(`trash ${paths.join(',')}`)
    return Promise.resolve(paths.map((path) => ({ path, back: `/trash${path}`, at: 2 })))
  },
  untrash: (tickets: { path: string }[]) => {
    asked.push(`untrash ${tickets.map((one) => one.path).join(',')}`)
    return Promise.resolve(tickets.map((one) => one.path))
  },
  PROGRESS: 'explorer://progress',
  cancelJob: () => Promise.resolve(),
}))

const recorded: FileAction[] = []
vi.mock('../workspace.svelte', () => ({
  workspace: { tabs: [], undone: { record: (one: FileAction) => recorded.push(one) } },
}))

const { redoOutside, undoOutside } = await import('./undo')

beforeEach(() => {
  asked.length = 0
  recorded.length = 0
})

describe("a file explorer's undo", () => {
  test('puts a move back and brings back what it replaced, newest first', async () => {
    await undoOutside({
      kind: 'outside',
      steps: [
        { op: 'replaced', tickets: [{ path: '/b/a.txt', back: '/t', at: 1 }] },
        { op: 'moved', pairs: [{ from: '/a/a.txt', to: '/b/a.txt' }] },
      ],
    })
    expect(asked).toEqual(['move /b/a.txt>/a/a.txt', 'untrash /b/a.txt'])
  })

  test('takes a copy back into the trash rather than deleting it', async () => {
    await undoOutside({
      kind: 'outside',
      steps: [{ op: 'copied', pairs: [{ from: '/a/x', to: '/b/x' }] }],
    })
    expect(asked).toEqual(['trash /b/x'])
  })

  test('does it again under the names it had, and records that as a change of its own', async () => {
    const made = {
      kind: 'outside' as const,
      steps: [{ op: 'made' as const, path: '/a/New folder' }],
    }
    await undoOutside(made)
    expect(asked).toEqual(['trash /a/New folder'])
    await redoOutside(made)
    expect(asked.at(-1)).toBe('untrash /a/New folder')
    await redoOutside({
      kind: 'outside',
      steps: [
        { op: 'trashed', tickets: [{ path: '/a/old', back: '/t', at: 1 }] },
        { op: 'copied', pairs: [{ from: '/a/x', to: '/b/x' }] },
      ],
    })
    expect(asked.slice(-2)).toEqual(['trash /a/old', 'copy /a/x>/b/x'])
    expect(recorded.at(-1)).toEqual({
      kind: 'outside',
      steps: [
        { op: 'trashed', tickets: [{ path: '/a/old', back: '/trash/a/old', at: 2 }] },
        { op: 'copied', pairs: [{ from: '/a/x', to: '/b/x' }] },
      ],
    })
  })

  test('takes back names that swapped places through names of their own first', async () => {
    await undoOutside({
      kind: 'outside',
      steps: [
        {
          op: 'moved',
          pairs: [
            { from: '/a/x', to: '/a/y' },
            { from: '/a/y', to: '/a/x' },
          ],
        },
      ],
    })
    expect(asked).toEqual([
      'move /a/y>/a/.orden-renaming-0-x,/a/x>/a/.orden-renaming-1-y',
      'move /a/.orden-renaming-0-x>/a/x,/a/.orden-renaming-1-y>/a/y',
    ])
  })
})
