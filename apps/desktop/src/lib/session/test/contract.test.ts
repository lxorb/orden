import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ClosedTabs, type Draft, type Layout, Layouts, panels, readDraft, readSession } from '../src/api'

const draft = (path: string | null, dirty = false): Draft => ({
  kind: 'note',
  path,
  name: path ?? 'Untitled',
  doc: dirty ? 'words' : '',
  dirty,
  cursor: 0,
  scroll: 0,
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
  test('keeps the tab hidden behind a tab, one deep', () => {
    const behind = { ...draft('/Notes/a.md'), twin: { ...draft(null), twin: draft('/Notes/b.md') } }
    const read = readDraft(JSON.parse(JSON.stringify(behind)))
    expect(read?.twin).toEqual(draft(null))
    expect(readDraft(draft('/Notes/a.md'))).not.toHaveProperty('twin')
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
describe('the layouts kept under a name', () => {
  const KEY = 'orden:layouts'
  const layout: Layout = {
    focused: 'p',
    panel: null,
    frame: { kind: 'pane', pane: { id: 'p', tabs: [], active: 0, linked: false } },
  }
  const names = (layouts: Layouts) => layouts.all.map((one) => one.name)
  const savedNames = (): unknown[] =>
    (JSON.parse(localStorage.getItem(KEY) ?? '[]') as { name: string }[]).map((one) => one.name)
  function elsewhere(value: unknown) {
    localStorage.setItem(KEY, JSON.stringify(value))
    window.dispatchEvent(Object.assign(new Event('storage'), { key: KEY }))
  }
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => vi.unstubAllGlobals())
  test('show a layout another window saved as soon as it is heard', () => {
    const here = new Layouts()
    here.save('Mine', layout)
    elsewhere([...here.all, { name: 'Theirs', layout }])
    expect(names(here)).toEqual(['Mine', 'Theirs'])
  })
  test('saving or removing one here keeps the layouts another window saved', () => {
    const here = new Layouts()
    here.save('Mine', layout)
    here.save('Gone', layout)
    localStorage.setItem(KEY, JSON.stringify([...here.all, { name: 'Theirs', layout }]))
    here.save('Also mine', layout)
    expect(savedNames()).toEqual(['Also mine', 'Gone', 'Mine', 'Theirs'])
    here.remove('Gone')
    expect(savedNames()).toEqual(['Also mine', 'Mine', 'Theirs'])
    expect(names(new Layouts())).toEqual(['Also mine', 'Mine', 'Theirs'])
  })
})
