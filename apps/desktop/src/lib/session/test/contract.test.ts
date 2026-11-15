import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  ClosedTabs,
  type Draft,
  loadSessionsLeft,
  loadSlots,
  loadUnwritten,
  panels,
  readDraft,
  readSession,
} from '../src/api'

const SRC = join(import.meta.dirname, '../src')

const draft = (path: string | null, dirty = false): Draft => ({
  kind: 'note',
  path,
  name: path ?? 'Untitled',
  doc: dirty ? 'words' : '',
  dirty,
  cursor: 0,
  scroll: 0,
})

describe('the module stands on its own', () => {
  test('reaches no app module but the ones it declares', () => {
    const reached = readdirSync(SRC)
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
      .flatMap((name) =>
        [...readFileSync(join(SRC, name), 'utf8').matchAll(/from '(\.\.[^']*)'/g)].map(
          (found) => found[1],
        ),
      )
    expect([...new Set(reached)].sort()).toEqual([
      '../../collab/src/api',
      '../../documents/src/api',
      '../../file-ops/src/api',
      '../../panes/src/api',
      '../../platform/src/api',
      '../../tab-kinds/src/api',
    ])
  })

  test('keeps the window slot, what other windows left and unwritten words behind doors', async () => {
    expect(typeof (await loadSlots()).takeSlot).toBe('function')
    expect(typeof (await loadSessionsLeft()).takeSessionsLeft).toBe('function')
    expect(typeof (await loadUnwritten()).cameBack).toBe('function')
  })
})

describe('a session written down', () => {
  test('reads back its spaces and panels and drops what it does not know', () => {
    const session = readSession({
      spaces: [{ id: 's', name: 'Notes', root: '/Notes' }, { id: 3 }],
      activeSpace: 's',
      panel: 'tree',
      right: ['outline', 'outline', 'elsewhere'],
    })
    expect(session?.spaces).toEqual([{ id: 's', name: 'Notes', root: '/Notes' }])
    expect(session?.panel).toBe('tree')
    expect(session?.right).toEqual(['outline'])
    expect(readSession('not a session')).toBeNull()
  })

  test('names a built-in view by its own name', () => {
    const read = readDraft({ kind: 'view', path: null, name: 'Old', doc: '{"builtin":"todos"}' })
    expect(read?.name).toBe('Todos')
  })

  test('starts the right side with the panels about one note', () => {
    expect(panels.rightFrom(undefined)).toEqual([...panels.STARTS_RIGHT])
    expect(panels.mayLiveOn('tree', 'left')).toBe(true)
  })
})

describe('the tabs that were closed', () => {
  test('come back newest first and follow a file that moved', () => {
    const closed = new ClosedTabs()
    closed.record({ draft: draft('/s/A.md'), paneId: 'p', at: 1 })
    closed.record({ draft: draft('/s/B.md'), paneId: 'p', at: 2 })
    closed.follow({ op: 'moved', kind: 'file', from: '/s/B.md', to: '/s/C.md', root: '/s' })
    expect(closed.take().map((one) => one.draft.path)).toEqual(['/s/C.md'])
    expect(closed.take().map((one) => one.draft.name)).toEqual(['/s/A.md'])
    expect(closed.any).toBe(false)
  })

  test('let go of a deleted file but keep its unsaved words', () => {
    const closed = new ClosedTabs()
    closed.record({ draft: draft('/s/A.md', true), paneId: 'p', at: 1 })
    closed.follow({ op: 'removed', kind: 'file', path: '/s/A.md', root: '/s' })
    expect(closed.take()[0]?.draft).toMatchObject({ path: null, doc: 'words', dirty: true })
  })
})
