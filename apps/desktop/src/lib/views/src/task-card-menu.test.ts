import type { Row } from '@orden/bases'
import { rowsOf } from '@orden/bases/rows'
import { scanRows } from '@orden/bases/scan'
import { scanNote } from '@orden/scan/note'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const notes = new Map<string, string>()
const removed: string[] = []
const copied: string[] = []

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    spaces: [{ name: 'Space', root: '/space' }],
    undone: { last: null, stack: [] },
    remove: (path: string) => {
      removed.push(path)
      return Promise.resolve()
    },
    duplicate: (path: string) => {
      removed.push(`duplicate ${path}`)
      return Promise.resolve()
    },
  },
  noteText: (_: unknown, path: string) => Promise.resolve(notes.get(path) ?? null),
  replaceInNotes: (
    _: unknown,
    changes: readonly {
      path: string
      before: string
      edits: { from: number; to: number; insert: string }[]
    }[],
  ) => {
    for (const change of changes) {
      let text = change.before
      for (const edit of [...change.edits].sort((a, b) => b.from - a.from)) {
        text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
      }
      notes.set(change.path, text)
    }
    return Promise.resolve(true)
  },
}))

vi.mock('../../ui-controls/src/api', async (actual) => ({
  ...(await actual<object>()),
  copyText: (text: string) => {
    copied.push(text)
    return Promise.resolve()
  },
}))

vi.mock('../../rows/src/api', async () => ({
  rows: {},
  changed: (await import('../../rows/src/write')).changed,
}))

const { cardEntries } = await import('./board-menus')

const PATH = '/space/Daily.md'
const NOTE = '# Daily\n\n- [ ] call bob\n  - [ ] find number\n- [ ] buy milk\n\nNotes stay.\n'

function taskRow(text: string, words: string): Row {
  const found = rowsOf('Space', {
    ...scanNote('Daily.md', text),
    ...scanRows(text),
    stamp: null,
  }).find((row) => row.task?.text === words)
  if (!found) throw new Error(`no task ${words}`)
  return found
}

async function pick(label: string, row: Row) {
  const entries = cardEntries({
    kit: { choose: () => undefined, open: () => undefined } as never,
    event: {} as MouseEvent,
    row,
    targets: [],
    move: () => undefined,
  })
  const entry = entries.find(
    (one) => (one as { label?: string; run?: () => void } | null)?.label === label,
  ) as { run?: () => void } | undefined
  if (!entry?.run) throw new Error(`no ${label}`)
  entry.run()
  await new Promise((resolve) => setTimeout(resolve))
}

beforeEach(() => {
  notes.clear()
  notes.set(PATH, NOTE)
  removed.length = 0
  copied.length = 0
})

describe('the menu of a task card', () => {
  test('Delete takes the task and its subtasks out of the note and keeps the note', async () => {
    await pick('Delete', taskRow(NOTE, 'call bob'))
    expect(removed).toEqual([])
    expect(notes.get(PATH)).toBe('# Daily\n\n- [ ] buy milk\n\nNotes stay.\n')
  })

  test('Duplicate copies the task, not the note', async () => {
    await pick('Duplicate', taskRow(NOTE, 'buy milk'))
    expect(removed).toEqual([])
    expect(notes.get(PATH)).toBe(
      '# Daily\n\n- [ ] call bob\n  - [ ] find number\n- [ ] buy milk\n- [ ] buy milk\n\nNotes stay.\n',
    )
  })

  test('Copy link names the task as a block of its note', async () => {
    await pick('Copy link', taskRow(NOTE, 'buy milk'))
    const [link] = copied
    expect(link).toMatch(/^\[\[Daily#\^[\w-]+\]\]$/)
    const id = link?.slice(link.indexOf('^') + 1, -2) ?? ''
    expect(notes.get(PATH)).toContain(`- [ ] buy milk ^${id}\n`)
  })
})
