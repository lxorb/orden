import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
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
async function shown(View: (typeof VIEWS)[number][1]) {
  const ids: string[] = []
  for (const title of ['Outside a', 'Outside b']) {
    const one = await addTask(title, { typed: false })
    if (!one) throw new Error('no todo')
    ids.push(one.id)
  }
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(View, { target })
  close = () => void unmount(view)
  flushSync()
  const pick = (id: string, keys: MouseEventInit = {}) => {
    target
      .querySelector(`[data-todo="${id}"] button.body`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...keys }))
    flushSync()
  }
  const picked = () =>
    [...target.querySelectorAll<HTMLElement>('[data-todo]')]
      .filter((one) => one.querySelector('.orden-said')?.textContent === 'Selected')
      .map((one) => one.dataset.todo)
  const press = (on: Element) => {
    on.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
    flushSync()
  }
  return { target, ids, pick, picked, press }
}
function elsewhere(attrs: Record<string, string> = {}) {
  const one = document.createElement('div')
  for (const [name, value] of Object.entries(attrs)) one.setAttribute(name, value)
  document.body.append(one)
  return one
}
test.each(VIEWS)('a press anywhere outside the %s lets the picked todos go, as Escape does', async (_, View) => {
  const { ids, pick, picked, press } = await shown(View)
  const [a = '', b = ''] = ids
  pick(a)
  expect(picked()).toEqual([a])
  press(document.body)
  expect(picked()).toEqual([])
  pick(a)
  pick(b, { ctrlKey: true })
  expect(picked()).toEqual(expect.arrayContaining([a, b]))
  press(elsewhere({ class: 'pane' }))
  expect(picked()).toEqual([])
})
test.each(VIEWS)('a press on a todo, the todo sheet or a menu keeps the %s picks', async (_, View) => {
  const { target, ids, pick, picked, press } = await shown(View)
  const [a = '', b = ''] = ids
  pick(a)
  press(target.querySelector(`[data-todo="${b}"] button.body`) ?? document.body)
  expect(picked()).toEqual([a])
  for (const attrs of [{ 'data-todo-editor': '' }, { role: 'menu' }, { 'data-covers': '' }]) {
    press(elsewhere(attrs))
    expect(picked(), JSON.stringify(attrs)).toEqual([a])
  }
})
