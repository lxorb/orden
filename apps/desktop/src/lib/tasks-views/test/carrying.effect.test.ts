import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { addTask, type Board, todos } from '../../tasks-model/src/api'
import { patchTodo } from '../src/acts'
import { Carrying } from '../src/carrying.svelte'
import { Shown, type ShownWorld } from '../src/shown.svelte'

providePort('sync.account', {
  token: null,
  user: null,
  spaces: [],
  signedIn: false,
  loadSpaces: async () => undefined,
  recheck: async () => undefined,
  signedOutBy: () => false,
  forgetWithSession: () => undefined,
  askBeforeLeaving: () => undefined,
})
const prefix = () => `t${String(Math.random()).slice(2, 8)}`
function shownOf(mine: string, where: 'panel' | 'board' = 'board') {
  let board: Board = {
    grouping: 'label',
    done: false,
    anyStart: false,
    columns: { label: [], deadline: [], priority: [], space: [] },
  }
  const world: ShownWorld = {
    todos: () => todos.todos.filter((one) => one.title.startsWith(mine)),
    activeSpace: () => null,
    spaces: () => [],
    today: () => '2026-11-19',
    kept: () => undefined,
    keep: () => undefined,
    board: () => board,
    arrange: (next) => (board = next),
  }
  const shown = new Shown(world, where)
  const carrying = new Carrying({
    shown,
    list: (key) => (where === 'panel' ? shown.todos : (shown.columns.find((one) => one.key === key)?.todos ?? [])),
    grouping: () => (where === 'panel' ? null : shown.grouping),
  })
  return { shown, carrying }
}
async function made(mine: string, title: string, labels: string[] = []) {
  const one = await addTask(`${mine} ${title}`, { typed: false })
  if (!one) throw new Error('no todo')
  if (labels.length) await patchTodo(one.id, { labels })
  const held = todos.todo(one.id)
  if (!held) throw new Error('not held')
  return held
}
const titles = (list: readonly { title: string }[], mine: string) => list.map((one) => one.title.slice(mine.length + 1))
describe('a carried todo', () => {
  test('let go further down a list takes that place and the list is sorted by hand from then on', async () => {
    const mine = prefix()
    const a = await made(mine, 'a')
    await made(mine, 'b')
    await made(mine, 'c')
    const { shown, carrying } = shownOf(mine, 'panel')
    expect(titles(shown.todos, mine)).toEqual(['a', 'b', 'c'])
    carrying.started(a, '')
    carrying.aim('', shown.todos[2]?.id ?? null, true)
    expect(carrying.drag.spot).toEqual({ column: '', at: 2 })
    await carrying.land()
    expect(shown.sort).toBe('manual')
    expect(titles(shown.todos, mine)).toEqual(['b', 'c', 'a'])
    expect(carrying.drag.on).toBe(false)
  })
  test('let go in another label column swaps its label and takes its place there', async () => {
    const mine = prefix()
    const a = await made(mine, 'a', ['home'])
    await made(mine, 'b', ['work'])
    await made(mine, 'c', ['work'])
    const { shown, carrying } = shownOf(mine)
    shown.setSort('manual')
    carrying.started(a, 'home')
    const work = shown.columns.find((one) => one.key === 'work')?.todos ?? []
    carrying.aim('work', work[0]?.id ?? null, true)
    await carrying.land()
    expect(todos.todo(a.id)?.labels).toEqual(['work'])
    expect(titles(shown.columns.find((one) => one.key === 'work')?.todos ?? [], mine)).toEqual(['b', 'a', 'c'])
  })
  test('let go in a priority column takes that priority', async () => {
    const mine = prefix()
    const a = await made(mine, 'a')
    const { shown, carrying } = shownOf(mine)
    shown.setGrouping('priority')
    carrying.started(a, '0')
    carrying.aim('3', null, true)
    await carrying.land()
    expect(todos.todo(a.id)?.priority).toBe(3)
  })
  test('let go where it was changes nothing', async () => {
    const mine = prefix()
    const a = await made(mine, 'a')
    await made(mine, 'b')
    const { shown, carrying } = shownOf(mine, 'panel')
    const order = todos.todo(a.id)?.order
    carrying.started(a, '')
    carrying.aim('', shown.todos[1]?.id ?? null, false)
    await carrying.land()
    expect(todos.todo(a.id)?.order).toBe(order)
    expect(shown.sort).toBe('deadline')
  })
  test('moves one step with the keyboard', async () => {
    const mine = prefix()
    await made(mine, 'a')
    const b = await made(mine, 'b')
    const { shown, carrying } = shownOf(mine, 'panel')
    await carrying.step('', b.id, -1)
    expect(titles(shown.todos, mine)).toEqual(['b', 'a'])
  })
  test('carried from the panel onto a board column takes that column', async () => {
    const mine = prefix()
    const a = await made(mine, 'a')
    await made(mine, 'b', ['work'])
    const { carrying } = shownOf(mine)
    carrying.started(a, 'panel:')
    carrying.aim('work', null, true)
    await carrying.land()
    expect(todos.todo(a.id)?.labels).toEqual(['work'])
  })
})
