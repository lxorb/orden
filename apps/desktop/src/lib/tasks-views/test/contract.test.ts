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
  space: string | null
  start: string | null
  deadline: string | null
  priority: 0 | 1 | 2 | 3
  done: boolean
  doneAt: number | null
  subtasks: never[]
  order: number
  created: number
}
const todo = (over: Partial<Fake>): Fake => ({
  id: 'x',
  title: 'a todo',
  description: '',
  labels: [],
  space: null,
  start: null,
  deadline: null,
  priority: 0,
  done: false,
  doneAt: null,
  subtasks: [],
  order: 0,
  created: 0,
  ...over,
})
const plain = (): ReturnType<ShownWorld['board']> => ({
  grouping: 'label',
  done: false,
  anyStart: false,
  columns: { label: [], deadline: [], priority: [], space: [] },
})
function world(list: Fake[], active: string | null = 'home') {
  let kept: unknown = undefined
  let board = plain()
  const made: ShownWorld = {
    todos: () => list,
    activeSpace: () => (active === null ? null : { id: active, name: `Space ${active}` }),
    spaces: () => [
      { id: 'home', name: 'Space home' },
      { id: 'work', name: 'Space work' },
    ],
    today: () => TODAY,
    kept: () => kept,
    keep: (value) => (kept = value),
    board: () => board,
    arrange: (next) => (board = next),
  }
  return { world: made, read: () => kept, board: () => board }
}
describe('tasks-views contract', () => {
  test("a note chip opens only a note that is there, found in the todo's own space, and after a rename the renamed one", async () => {
    desk.notes.set('/s/home', { Plan: 'Work/Plan.md' })
    desk.notes.set('/s/work', { Plan: 'Plan.md' })
    desk.followed.length = 0
    await openNote('Gone', 'home')
    await openNote('Gone', null)
    expect(desk.followed).toEqual([])
    await openNote('Plan', 'home')
    expect(desk.followed).toEqual([
      [{ path: 'Work/Plan.md', target: 'Plan', heading: null, block: null, page: null }, undefined, '/s/home'],
    ])
    desk.notes.set('/s/home', { Roadmap: 'Work/Roadmap.md' })
    desk.followed.length = 0
    await openNote('Plan', 'home')
    await openNote('Roadmap', 'home')
    expect(desk.followed).toEqual([
      [{ path: 'Work/Roadmap.md', target: 'Roadmap', heading: null, block: null, page: null }, undefined, '/s/home'],
    ])
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
          one === 'svelte/easing' ||
          one === '../../tasks-model/src/api' ||
          one === '../../platform/src/api' ||
          one === '../../ui-controls/src/api' ||
          one === '../../ui-kit/src/api' ||
          one === '../../shortcuts/src/api' ||
          one === 'svelte/animate' ||
          one === '../../windows/src/api' ||
          one === '../../undo-toast/src/api' ||
          one === '../../ai-chat/src/api'
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
  test('"only this space" and the sort are kept between openings, the label is not', () => {
    const { world: w, read } = world([todo({ id: 'a', labels: ['x'] })])
    const first = new Shown(w)
    first.setOnlySpace(true)
    first.setSort('manual')
    first.setLabel('x')
    expect(read()).toEqual({ onlySpace: true, sort: 'manual', done: false })
    const second = new Shown(w)
    expect(second.onlySpace).toBe(true)
    expect(second.sort).toBe('manual')
    expect(second.label).toBeNull()
  })
  test('the label dropdown lists only labels carried by shown todos, within the space when asked', () => {
    const { world: w } = world([
      todo({ id: 'a', space: 'home', labels: ['errand'] }),
      todo({ id: 'b', space: 'work', labels: ['meeting'] }),
      todo({ id: 'c', space: 'home', labels: ['later'], start: '2026-12-01' }),
    ])
    const shown = new Shown(w)
    expect(shown.labels).toEqual(['errand', 'meeting'])
    shown.setOnlySpace(true)
    expect(shown.labels).toEqual(['errand'])
    expect(shown.todos.map((t) => t.id)).toEqual(['a'])
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
  test('with no open space the space filter cannot narrow anything', () => {
    const { world: w } = world([todo({ id: 'a', space: 'home' }), todo({ id: 'b' })], null)
    const shown = new Shown(w)
    shown.setOnlySpace(true)
    expect(shown.space).toBeNull()
    expect(shown.spaceName('work')).toBe('Space work')
    expect(shown.todos.map((t) => t.id).sort()).toEqual(['a', 'b'])
  })
  test('done todos stay hidden until Show done is on, and one just ticked lingers a moment', () => {
    vi.useFakeTimers()
    const list = [todo({ id: 'a', done: true, doneAt: 1 }), todo({ id: 'b' })]
    const { world: w, read } = world(list)
    const shown = new Shown(w)
    expect(shown.todos.map((t) => t.id)).toEqual(['b'])
    shown.linger('a', 500)
    expect(shown.todos.map((t) => t.id)).toEqual(['b', 'a'])
    vi.advanceTimersByTime(600)
    expect(shown.todos.map((t) => t.id)).toEqual(['b'])
    shown.setShowDone(true)
    expect(shown.todos.map((t) => t.id)).toEqual(['b', 'a'])
    expect(read()).toEqual({ onlySpace: false, sort: 'deadline', done: true })
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
