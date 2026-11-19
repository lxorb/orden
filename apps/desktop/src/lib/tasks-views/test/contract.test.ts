import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { openNote } from '../src/notes'
import { Shown, type ShownWorld, SORT_NAMES } from '../src/shown.svelte'

const desk = vi.hoisted(() => ({
  notes: new Map<string, Record<string, string>>(),
  followed: [] as unknown[][],
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    spaces: [
      { id: 'home', root: '/s/home' },
      { id: 'work', root: '/s/work' },
    ],
    activeSpace: { id: 'work', root: '/s/work' },
  },
  followNote: (...said: unknown[]) => void desk.followed.push(said),
}))
vi.mock('../../link-index/src/api', () => ({
  links: {
    spaceRead: async () => undefined,
    reachedOf: (from: string, link: { target: string }) => desk.notes.get(from)?.[link.target] ?? null,
  },
}))

const TODAY = '2026-11-14'
interface Fake {
  id: string
  title: string
  description: string
  labels: string[]
  start: string | null
  deadline: string | null
  priority: 0 | 1 | 2 | 3
  done: boolean
  doneAt: number | null
  subtasks: never[]
  repeat: string | null
  order: number
  created: number
}
const todo = (over: Partial<Fake>): Fake => ({
  id: 'x',
  title: 'a todo',
  description: '',
  labels: [],
  start: null,
  deadline: null,
  priority: 0,
  done: false,
  doneAt: null,
  subtasks: [],
  repeat: null,
  order: 0,
  created: 0,
  ...over,
})
const plain = (): ReturnType<ShownWorld['board']> => ({
  grouping: 'label',
  done: false,
  anyStart: false,
  columns: { label: [], deadline: [], priority: [] },
})
function world(list: Fake[], active: string | null = 'home') {
  let kept: unknown = undefined
  let board = plain()
  const made: ShownWorld = {
    todos: () => list,
    activeSpace: () => (active === null ? null : { id: active, name: `Space ${active}` }),
    today: () => TODAY,
    kept: () => kept,
    keep: (value) => (kept = value),
    board: () => board,
    arrange: (next) => (board = next),
  }
  return { world: made, read: () => kept, board: () => board }
}
describe('tasks-views contract', () => {
  test('a note chip opens only a note that is there, first in the space in sight, then in the other spaces, and after a rename the renamed one', async () => {
    desk.notes.set('/s/home', { Plan: 'Work/Plan.md', Only: 'Only.md' })
    desk.notes.set('/s/work', { Plan: 'Plan.md' })
    desk.followed.length = 0
    await openNote('Gone')
    expect(desk.followed).toEqual([])
    await openNote('Plan')
    await openNote('Only')
    expect(desk.followed).toEqual([
      [{ path: 'Plan.md', target: 'Plan', heading: null, block: null, page: null }, undefined, '/s/work'],
      [{ path: 'Only.md', target: 'Only', heading: null, block: null, page: null }, undefined, '/s/home'],
    ])
    desk.notes.set('/s/home', { Roadmap: 'Work/Roadmap.md' })
    desk.notes.set('/s/work', {})
    desk.followed.length = 0
    await openNote('Plan')
    await openNote('Roadmap')
    expect(desk.followed).toEqual([
      [{ path: 'Work/Roadmap.md', target: 'Roadmap', heading: null, block: null, page: null }, undefined, '/s/home'],
    ])
  })
  test('a priority takes its tone only from the model, no view keeps its own table of tones', () => {
    const src = join(import.meta.dirname, '..', 'src')
    for (const name of readdirSync(src)) {
      const text = readFileSync(join(src, name), 'utf8')
      expect(/callout-(note|warning)|canvas-\d|TONES/.test(text), name).toBe(false)
    }
  })
  test('the module reads the model, the motion, the shortcuts, the shared controls and the shell parts it borrows only through their apis', () => {
    const src = join(import.meta.dirname, '..', 'src')
    for (const name of readdirSync(src)) {
      const text = readFileSync(join(src, name), 'utf8')
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '')
      for (const one of imports) {
        const allowed =
          one.startsWith('./') ||
          one === 'svelte' ||
          one === '@orden/contracts' ||
          one === '@orden/bases/language' ||
          one === 'svelte/easing' ||
          one === '../../tasks-model/src/api' ||
          one === '../../platform/src/api' ||
          one === '../../ui-controls/src/api' ||
          one === '../../ui-kit/src/api' ||
          one === '../../shortcuts/src/api' ||
          one === 'svelte/animate' ||
          one === '../../windows/src/api' ||
          one === '../../undo-toast/src/api' ||
          one === '../../ai-chat/src/api' ||
          one === '../../tree/src/api'
        expect(allowed, `${name} imports ${one}`).toBe(true)
      }
    }
  })
  test('the window offers exactly deadline, priority and manual sorting, deadline by default', () => {
    const { world: w } = world([])
    const shown = new Shown(w)
    expect(Object.keys(SORT_NAMES)).toEqual(['deadline', 'priority', 'manual'])
    expect(shown.sort).toBe('deadline')
  })
  test('the sort is kept between openings, the label is not, and an old kept "only this space" is left out', () => {
    const { world: w, read } = world([todo({ id: 'a', labels: ['x'] }), todo({ id: 'b' })])
    w.keep({ onlySpace: true, sort: 'deadline', done: false })
    const first = new Shown(w)
    expect(first.todos.map((t) => t.id)).toEqual(['a', 'b'])
    first.setSort('manual')
    first.setLabel('x')
    expect(read()).toEqual({ sort: 'manual', done: false, group: null, folded: [] })
    const second = new Shown(w)
    expect(second.sort).toBe('manual')
    expect(second.label).toBeNull()
  })
  test('the label dropdown lists only labels carried by shown todos', () => {
    const { world: w } = world([
      todo({ id: 'a', labels: ['errand'] }),
      todo({ id: 'b', labels: ['meeting'] }),
      todo({ id: 'c', labels: ['later'], start: '2026-12-01' }),
    ])
    const shown = new Shown(w)
    expect(shown.labels).toEqual(['errand', 'meeting'])
  })
  test('a chosen label that no todo carries any more falls back to all labels', () => {
    const list = [todo({ id: 'a', labels: ['x'] }), todo({ id: 'b' })]
    const { world: w } = world(list)
    const shown = new Shown(w)
    shown.setLabel('x')
    expect(shown.todos.map((t) => t.id)).toEqual(['a'])
    list.shift()
    expect(shown.filter.label).toBeNull()
    expect(shown.todos.map((t) => t.id)).toEqual(['b'])
  })
  test('the board groups by label with the unlabeled column last and follows the sort', () => {
    const { world: w } = world([
      todo({ id: 'a', labels: ['work'], deadline: '2026-11-20', order: 2 }),
      todo({ id: 'b', labels: ['work'], deadline: '2026-11-16', order: 1 }),
      todo({ id: 'c', order: 0 }),
    ])
    const shown = new Shown(w, 'board')
    expect(shown.columns.map((g) => [g.key, g.todos.map((t) => t.id)])).toEqual([
      ['work', ['b', 'a']],
      ['', ['c']],
    ])
    shown.setSort('manual')
    expect(shown.columns[0]?.todos.map((t) => t.id)).toEqual(['b', 'a'])
  })
  test('a todo has no space, and the board cannot group by one', () => {
    const { world: w } = world([todo({ id: 'a' })], null)
    const shown = new Shown(w, 'board')
    expect(Object.keys(shown.todos[0] ?? {})).not.toContain('space')
    expect(shown.space).toBeNull()
    expect(shown.todos.map((t) => t.id)).toEqual(['a'])
  })
  test('the panel groups by none, label, deadline or priority, and keeps its grouping and folded groups on this device', () => {
    const { world: w, read } = world([todo({ id: 'a', labels: ['x'] }), todo({ id: 'b' })])
    const first = new Shown(w)
    expect(first.group).toBeNull()
    expect(first.groups).toEqual([])
    first.setGroup('label')
    first.fold('x')
    expect(first.groups.map((one) => [one.key, one.todos.map((t) => t.id)])).toEqual([
      ['x', ['a']],
      ['', ['b']],
    ])
    expect(read()).toMatchObject({ group: 'label', folded: ['x'] })
    const second = new Shown(w)
    expect(second.group).toBe('label')
    expect(second.folded).toEqual(['x'])
    second.fold('x')
    expect(new Shown(w).folded).toEqual([])
  })
  test('done todos stay hidden until Show done is on, and one just ticked lingers a moment where it stood', () => {
    vi.useFakeTimers()
    const list = [todo({ id: 'a', done: true, doneAt: 1 }), todo({ id: 'b' })]
    const { world: w, read } = world(list)
    const shown = new Shown(w)
    expect(shown.todos.map((t) => t.id)).toEqual(['b'])
    shown.linger('a', 500)
    expect(shown.todos.map((t) => t.id)).toEqual(['a', 'b'])
    vi.advanceTimersByTime(600)
    expect(shown.todos.map((t) => t.id)).toEqual(['b'])
    shown.setShowDone(true)
    expect(shown.todos.map((t) => t.id)).toEqual(['b', 'a'])
    expect(read()).toEqual({ sort: 'deadline', done: true, group: null, folded: [] })
    vi.useRealTimers()
  })
  test('the board keeps its grouping, Show done, Ignore start date and column order in the synced board', () => {
    const list = [
      todo({ id: 'a', labels: ['x'] }),
      todo({ id: 'b', labels: ['y'] }),
      todo({ id: 'c', start: '2026-12-01', priority: 3 }),
    ]
    const { world: w, board } = world(list)
    const shown = new Shown(w, 'board')
    expect(shown.columns.map((one) => one.key)).toEqual(['x', 'y', ''])
    void shown.moveColumn('y', 0)
    expect(board().columns.label).toEqual(['y', 'x', ''])
    expect(shown.columns.map((one) => one.key)).toEqual(['y', 'x', ''])
    expect(shown.todos.map((t) => t.id)).not.toContain('c')
    shown.setAnyStart(true)
    expect(board().anyStart).toBe(true)
    expect(shown.todos.map((t) => t.id)).toContain('c')
    shown.setGrouping('priority')
    expect(board().grouping).toBe('priority')
    expect(shown.columns.map((one) => [one.name, one.todos.map((t) => t.id)])).toEqual([
      ['High', ['c']],
      ['Medium', []],
      ['Low', []],
      ['No priority', ['a', 'b']],
    ])
    shown.setShowDone(true)
    expect(board().done).toBe(true)
    const panel = new Shown(w)
    expect(panel.anyStart).toBe(false)
    expect(panel.showDone).toBe(false)
  })
})
