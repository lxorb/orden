import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { addTask, todos } from '../../tasks-model/src/api'
import { menu, type MenuEntry, prompt } from '../../ui-kit/src/api'
import { undoToast } from '../../undo-toast/src/api'
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
  menu.hide()
  undoToast.dismiss()
  document.body.replaceChildren()
  await Promise.all(todos.todos.map((one) => todos.remove(one.id)))
})
async function made(...titles: string[]) {
  const out = []
  for (const title of titles) {
    const one = await addTask(title, { typed: false })
    if (!one) throw new Error('no todo')
    out.push(one.id)
  }
  return out
}
function shown(View: typeof TodosPanel) {
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(View, { target })
  close = () => void unmount(view)
  flushSync()
  const row = (id: string) => target.querySelector<HTMLElement>(`[data-todo="${id}"]`)
  const body = (id: string) => row(id)?.querySelector<HTMLButtonElement>('button.body') ?? null
  const press = (id: string, keys: MouseEventInit = {}) => {
    body(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...keys }))
    flushSync()
  }
  const key = (on: Element | null | undefined, init: KeyboardEventInit) => {
    on?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    flushSync()
  }
  const picked = () =>
    [...target.querySelectorAll<HTMLElement>('[data-todo]')]
      .filter((one) => one.querySelector('.orden-said')?.textContent === 'Selected')
      .map((one) => one.dataset.todo)
  const list = () => target.querySelector<HTMLElement>('ul.list, .columns')
  return { target, row, body, press, key, picked, list }
}
const items = () => menu.items.filter((one): one is Exclude<MenuEntry, null> => one !== null)
const item = (label: string) => {
  const found = items().find((one) => one.label === label)
  if (!found)
    throw new Error(
      `no ${label} in ${items()
        .map((one) => one.label)
        .join(', ')}`,
    )
  return found
}
async function choose(label: string, inside: string) {
  const rows = (await item(inside).more?.()) ?? []
  const found = rows.find((one) => one !== null && one.label === label)
  if (!found) throw new Error(`no ${label} under ${inside}`)
  found.run()
}
const VIEWS = [
  ['panel', TodosPanel],
  ['board', TodosBoard],
] as const
describe.each(VIEWS)('picking todos in the %s', (_, View) => {
  test('Escape clears the picked todos, wherever the focus is', async () => {
    const [a = '', b = ''] = await made('Pick a', 'Pick b')
    const { press, key, picked } = shown(View)
    press(a, { ctrlKey: true })
    press(b, { ctrlKey: true })
    expect(picked()).toEqual([a, b])
    key(document.body, { key: 'Escape' })
    expect(picked()).toEqual([])
  })
  test('a click on empty space clears the picked todos', async () => {
    const [a = ''] = await made('Pick a')
    const { press, picked, list } = shown(View)
    press(a, { ctrlKey: true })
    list()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(picked()).toEqual([])
  })
  test('a plain click picks only that todo, Ctrl click toggles one', async () => {
    const [a = '', b = '', c = ''] = await made('Pick a', 'Pick b', 'Pick c')
    const { press, picked } = shown(View)
    press(a, { ctrlKey: true })
    press(b, { ctrlKey: true })
    press(a, { ctrlKey: true })
    expect(picked()).toEqual([b])
    press(c)
    expect(picked()).toEqual([c])
  })
  test('Shift click and Shift+Arrow stretch the picked range', async () => {
    const [a = '', b = '', c = ''] = await made('Pick a', 'Pick b', 'Pick c')
    const { press, key, body, picked } = shown(View)
    press(a, { ctrlKey: true })
    press(c, { shiftKey: true })
    expect(picked()).toEqual([a, b, c])
    key(document.body, { key: 'Escape' })
    body(a)?.focus()
    key(body(a), { key: 'ArrowDown', shiftKey: true })
    expect(picked()).toEqual([a, b])
  })
  test('Ctrl+A picks every shown todo', async () => {
    const [a = '', b = '', c = ''] = await made('Pick a', 'Pick b', 'Pick c')
    const { key, body, picked } = shown(View)
    body(a)?.focus()
    key(body(a), { key: 'a', ctrlKey: true })
    expect(picked()).toEqual([a, b, c])
  })
  test('ticking a picked todo ticks them all, and one Undo takes them all back', async () => {
    const [a = '', b = '', c = ''] = await made('Pick a', 'Pick b', 'Pick c')
    const { press, row } = shown(View)
    press(a, { ctrlKey: true })
    press(b, { ctrlKey: true })
    const tick = row(a)?.querySelector<HTMLInputElement>('.tick')
    if (!tick) throw new Error('no tick')
    tick.checked = true
    tick.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect([a, b, c].map((id) => todos.todo(id)?.done)).toEqual([true, true, false]))
    await vi.waitFor(() => expect(undoToast.own?.said).toBe('done'))
    await undoToast.own?.undo()
    await vi.waitFor(() => expect([a, b].map((id) => todos.todo(id)?.done)).toEqual([false, false]))
  })
  test('Delete takes every picked todo, and one Undo brings them back', async () => {
    const [a = '', b = ''] = await made('Pick a', 'Pick b')
    const { press, key, body } = shown(View)
    press(a, { ctrlKey: true })
    press(b, { ctrlKey: true })
    key(body(b), { key: 'Delete' })
    await vi.waitFor(() => expect(prompt.mode).toBe('confirm'))
    prompt.submit()
    await vi.waitFor(() => expect([a, b].map((id) => todos.todo(id))).toEqual([null, null]))
    await vi.waitFor(() => expect(undoToast.own?.said).toBe('deleted'))
    await undoToast.own?.undo()
    await vi.waitFor(() => expect([a, b].map((id) => todos.todo(id)?.id)).toEqual([a, b]))
  })
  test('the menu of a picked todo acts on all of them and says how many, an unpicked one is picked alone', async () => {
    const [a = '', b = '', c = ''] = await made('Pick a', 'Pick b', 'Pick c')
    await todos.update(c, { labels: ['home'] })
    const { press, row, picked } = shown(View)
    press(a, { ctrlKey: true })
    press(b, { ctrlKey: true })
    row(a)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    flushSync()
    expect(item('Delete 2 todos').danger).toBe(true)
    await choose('High', 'Priority')
    await choose('Tomorrow', 'Deadline')
    await choose('Today', 'Start date')
    await choose('home', 'Label')
    await vi.waitFor(() => expect([a, b, c].map((id) => todos.todo(id)?.priority)).toEqual([3, 3, 0]))
    await vi.waitFor(() => expect([a, b].map((id) => todos.todo(id)?.labels)).toEqual([['home'], ['home']]))
    await vi.waitFor(() => expect(todos.todo(b)?.deadline).not.toBeNull())
    expect(todos.todo(a)?.start).not.toBeNull()
    menu.hide()
    row(c)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    flushSync()
    expect(item('Delete').label).toBe('Delete')
    await vi.waitFor(() => expect(picked()).toEqual([c]))
  })
  test('a todo that stops being shown leaves the picked ones, and scrolling keeps them', async () => {
    const [a = '', b = ''] = await made('Pick a', 'Pick b')
    const { press, picked, list } = shown(View)
    press(a, { ctrlKey: true })
    press(b, { ctrlKey: true })
    list()?.dispatchEvent(new Event('scroll'))
    flushSync()
    expect(picked()).toEqual([a, b])
    await todos.update(b, { start: '2999-01-01' })
    await vi.waitFor(() => {
      flushSync()
      expect(picked()).toEqual([a])
    })
  })
})
