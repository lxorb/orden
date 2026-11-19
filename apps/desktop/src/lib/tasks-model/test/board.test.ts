import { describe, expect, test } from 'vitest'
import { MemoryTodoDisk, MemoryTodoServer, type StoreWorld, type Todo, TodoStore } from '../src/api'
import {
  boardOf,
  columnPatch,
  columnsOf,
  dayAfter,
  dueOf,
  movedColumns,
  movedPatch,
  orderedColumns,
} from '../src/board'

const TODAY = '2026-11-19'
const todo = (over: Partial<Todo>): Todo => ({
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
const place = { today: TODAY, spaces: [{ id: 'home', name: 'Home' }] }
const keys = (columns: ReturnType<typeof columnsOf>) => columns.map((one) => [one.key, one.todos.map((t) => t.id)])
describe('the board', () => {
  test('counts days across a month and a year', () => {
    expect(dayAfter('2026-11-30', 1)).toBe('2026-12-01')
    expect(dayAfter('2026-12-31', 1)).toBe('2027-01-01')
    expect(dueOf('2026-11-18', TODAY)).toBe('overdue')
    expect(dueOf(TODAY, TODAY)).toBe('today')
    expect(dueOf('2026-11-20', TODAY)).toBe('tomorrow')
    expect(dueOf('2026-11-26', TODAY)).toBe('week')
    expect(dueOf('2026-11-27', TODAY)).toBe('later')
    expect(dueOf(null, TODAY)).toBe('none')
  })
  test('groups by label, deadline, priority and space, with an empty column to drop or add into', () => {
    const all = [
      todo({ id: 'a', labels: ['work'], deadline: '2026-11-10', priority: 3, space: 'home' }),
      todo({ id: 'b', deadline: TODAY, priority: 1 }),
      todo({ id: 'c', deadline: '2027-02-01', space: 'gone' }),
    ]
    expect(keys(columnsOf(all, 'label', place))).toEqual([
      ['work', ['a']],
      ['', ['b', 'c']],
    ])
    expect(keys(columnsOf([], 'label', place))).toEqual([['', []]])
    expect(keys(columnsOf(all, 'deadline', place))).toEqual([
      ['overdue', ['a']],
      ['today', ['b']],
      ['tomorrow', []],
      ['week', []],
      ['later', ['c']],
      ['none', []],
    ])
    expect(columnsOf(all.slice(1, 2), 'deadline', place)[0]?.key).toBe('today')
    expect(keys(columnsOf(all, 'priority', place))).toEqual([
      ['3', ['a']],
      ['2', []],
      ['1', ['b']],
      ['0', ['c']],
    ])
    const spaces = columnsOf(all, 'space', place)
    expect(keys(spaces)).toEqual([
      ['home', ['a']],
      ['gone', ['c']],
      ['', ['b']],
    ])
    expect(spaces.map((one) => one.takes)).toEqual([true, false, true])
  })
  test('a column + gives a new todo the value of its column', () => {
    expect(columnPatch('label', 'work', TODAY)).toEqual({ labels: ['work'] })
    expect(columnPatch('label', '', TODAY)).toEqual({ labels: [] })
    expect(columnPatch('priority', '2', TODAY)).toEqual({ priority: 2 })
    expect(columnPatch('space', 'home', TODAY)).toEqual({ space: 'home' })
    expect(columnPatch('space', '', TODAY)).toEqual({ space: null })
    expect(columnPatch('deadline', 'today', TODAY)).toEqual({ deadline: TODAY })
    expect(columnPatch('deadline', 'tomorrow', TODAY)).toEqual({ deadline: '2026-11-20' })
    expect(columnPatch('deadline', 'week', TODAY)).toEqual({ deadline: '2026-11-21' })
    expect(columnPatch('deadline', 'later', TODAY)).toEqual({ deadline: '2026-11-27' })
    expect(columnPatch('deadline', 'none', TODAY)).toEqual({ deadline: null })
    expect(columnPatch('deadline', 'overdue', TODAY)).toBeNull()
  })
  test('a todo dragged to another column takes its value, and a label swaps for the new one', () => {
    const one = todo({ labels: ['work', 'calls'], deadline: '2026-11-22' })
    expect(movedPatch(one, 'label', 'work', 'home', TODAY)).toEqual({ labels: ['calls', 'home'] })
    expect(movedPatch(one, 'label', 'work', '', TODAY)).toEqual({ labels: [] })
    expect(movedPatch(todo({}), 'label', '', 'home', TODAY)).toEqual({ labels: ['home'] })
    expect(movedPatch(one, 'deadline', 'week', 'today', TODAY)).toEqual({ deadline: TODAY })
    expect(movedPatch(one, 'deadline', 'later', 'week', TODAY)).toBeNull()
    expect(movedPatch(one, 'priority', '0', '3', TODAY)).toEqual({ priority: 3 })
    expect(movedPatch(one, 'space', '', 'home', TODAY)).toEqual({ space: 'home' })
    expect(movedPatch(one, 'space', 'home', 'home', TODAY)).toBeNull()
  })
  test('columns follow a kept order, and new ones come after in their own order', () => {
    const columns = columnsOf([todo({ id: 'a', labels: ['b'] }), todo({ id: 'c', labels: ['a', 'c'] })], 'label', place)
    expect(orderedColumns(columns, ['c', 'b']).map((one) => one.key)).toEqual(['c', 'b', 'a', ''])
    expect(movedColumns(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(movedColumns(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a'])
  })
  test('is synced between two devices of one user and is never a todo', async () => {
    const server = new MemoryTodoServer()
    const store = () => {
      let clock = 1
      const world: StoreWorld = {
        openDisk: async () => new MemoryTodoDisk(),
        now: () => (clock += 1),
        channel: () => null,
        warn: () => undefined,
        later: () => () => undefined,
      }
      return new TodoStore(world)
    }
    const one = store()
    const two = store()
    await one.opened({ owner: 'u', server: server.forUser('u'), device: 'one' })
    await two.opened({ owner: 'u', server: server.forUser('u'), device: 'two' })
    const board = { ...boardOf(null), grouping: 'priority' as const, anyStart: true }
    await one.arrange({ ...board, columns: { ...board.columns, priority: ['0', '3'] } })
    await one.exchange()
    await two.exchange()
    expect(two.board.grouping).toBe('priority')
    expect(two.board.anyStart).toBe(true)
    expect(two.board.columns.priority).toEqual(['0', '3'])
    expect(two.todos).toEqual([])
  })
  test('a deleted todo comes back on undo', async () => {
    const world: StoreWorld = {
      openDisk: async () => new MemoryTodoDisk(),
      now: () => Date.now(),
      channel: () => null,
      warn: () => undefined,
      later: () => () => undefined,
    }
    const store = new TodoStore(world)
    await store.opened({ owner: null, server: null, device: 'd' })
    const made = await store.add({ title: 'Keep me' })
    if (!made.ok) throw new Error('not made')
    await store.remove(made.value.id)
    expect(store.todo(made.value.id)).toBeNull()
    const back = await store.restore(made.value.id)
    expect(back.ok && back.value.title).toBe('Keep me')
  })
})
