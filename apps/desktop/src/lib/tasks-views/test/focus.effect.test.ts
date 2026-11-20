import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { addTask, todos } from '../../tasks-model/src/api'
import { TodosBoard, TodosPanel } from '../src/api'

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
let close: (() => void) | undefined
afterEach(async () => {
  close?.()
  close = undefined
  document.body.replaceChildren()
  await Promise.all(todos.todos.map((one) => todos.remove(one.id)))
})
const VIEWS = [
  ['panel', TodosPanel],
  ['board', TodosBoard],
] as const
async function shownWith(View: (typeof VIEWS)[number][1], count: number) {
  const made: string[] = []
  for (let at = 0; at < count; at += 1) {
    const one = await addTask(`Errand ${String(at)} ${String(Math.random())}`, { typed: false })
    if (!one) throw new Error('no todo')
    made.push(one.id)
  }
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(View, { target })
  close = () => void unmount(shown)
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelectorAll('[data-todo]').length).toBe(count)
  })
  const order = () => [...target.querySelectorAll<HTMLElement>('[data-todo]')].map((one) => one.dataset.todo ?? '')
  const focus = (id: string) => target.querySelector<HTMLElement>(`[data-todo="${id}"] .body`)?.focus()
  const focused = () =>
    (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-todo]')?.dataset.todo
  return { target, order, focus, focused }
}
const press = (key: string) =>
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const settled = async (check: () => void) =>
  vi.waitFor(() => {
    flushSync()
    check()
  })

test.each(VIEWS)('deleting the focused todo in the %s keeps the keyboard on the next one', async (_, View) => {
  const { order, focus, focused } = await shownWith(View, 3)
  const [first, second, third] = order()
  focus(second ?? '')
  press('Delete')
  await settled(() => expect(order()).toEqual([first, third]))
  expect(focused()).toBe(third)
  press('Delete')
  await settled(() => expect(order()).toEqual([first]))
  expect(focused()).toBe(first)
  press('ArrowDown')
  expect(focused()).toBe(first)
})
test.each(VIEWS)('a focused todo removed by sync in the %s hands the keyboard to the next one', async (_, View) => {
  const { order, focus, focused } = await shownWith(View, 2)
  const [first, second] = order()
  focus(first ?? '')
  await todos.remove(first ?? '')
  await settled(() => expect(order()).toEqual([second]))
  expect(focused()).toBe(second)
})
test.each(VIEWS)('a focused todo ticked away in the %s hands the keyboard to the next one', async (_, View) => {
  const { order, focus, focused } = await shownWith(View, 2)
  const [first, second] = order()
  focus(first ?? '')
  await todos.update(first ?? '', { done: true })
  await settled(() => expect(order()).toEqual([second]))
  expect(focused()).toBe(second)
})
test.each(VIEWS)('the last todo deleted in the %s leaves the keyboard in the list', async (_, View) => {
  const { target, order, focus } = await shownWith(View, 1)
  focus(order()[0] ?? '')
  press('Delete')
  await settled(() => expect(order()).toEqual([]))
  expect(document.activeElement).not.toBe(document.body)
  expect(target.contains(document.activeElement)).toBe(true)
})
