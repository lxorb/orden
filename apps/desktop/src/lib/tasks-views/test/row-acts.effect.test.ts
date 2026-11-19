import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { addTask, todos } from '../../tasks-model/src/api'
import { menu, prompt } from '../../ui-kit/src/api'
import { TodosBoard, TodosPanel } from '../src/api'
import { swipedAway } from '../src/swipe-away'

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
afterEach(() => {
  close?.()
  close = undefined
  menu.hide()
  document.body.replaceChildren()
})
async function made(title: string) {
  const one = await addTask(`${title} ${String(Math.random())}`, { typed: false })
  if (!one) throw new Error('no todo')
  return one
}
function shown(View: typeof TodosPanel) {
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(View, { target })
  close = () => void unmount(view)
  flushSync()
  const row = (id: string) => target.querySelector<HTMLElement>(`[data-todo="${id}"]`)
  const body = (id: string) => row(id)?.querySelector<HTMLButtonElement>('button.body') ?? null
  return { target, row, body }
}
const gone = async (...ids: string[]) =>
  vi.waitFor(() => {
    for (const id of ids) expect(todos.todo(id)).toBeNull()
  })
const VIEWS = [
  ['panel', TodosPanel],
  ['board', TodosBoard],
] as const
describe.each(VIEWS)('a todo row in the %s', (_, View) => {
  test('opens a row menu whose Delete deletes it', async () => {
    const one = await made('Water the plants')
    const { row } = shown(View)
    row(one.id)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    flushSync()
    expect(menu.open).toBe(true)
    const remove = menu.items.find((item) => item !== null && item.label === 'Delete')
    if (!remove) throw new Error('no Delete in the row menu')
    expect(remove.danger).toBe(true)
    remove.run()
    await gone(one.id)
  })
  test('is deleted by the Delete key', async () => {
    const one = await made('Call the bank')
    const { body } = shown(View)
    body(one.id)?.focus()
    body(one.id)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    await gone(one.id)
  })
  test('is picked with another by an alt click, and the picked ones go together once asked', async () => {
    const first = await made('Read a book')
    const second = await made('Plan the trip')
    const { body, row } = shown(View)
    body(first.id)?.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))
    flushSync()
    body(second.id)?.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))
    flushSync()
    expect(row(first.id)?.classList.contains('is-picked')).toBe(true)
    expect(row(second.id)?.classList.contains('is-picked')).toBe(true)
    expect(document.querySelector('[data-todo-editor]')).toBeNull()
    body(second.id)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(prompt.mode).toBe('confirm'))
    expect(todos.todo(first.id)).not.toBeNull()
    prompt.submit()
    await gone(first.id, second.id)
  })
  test('is swiped away on a touch screen', async () => {
    const one = await made('Take out the bins')
    const { row } = shown(View)
    const line = row(one.id)
    if (!line) throw new Error('no row')
    Object.defineProperty(line, 'offsetWidth', { value: 300 })
    const finger = (type: string, x: number) =>
      line.dispatchEvent(
        Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10 }), {
          pointerType: 'touch',
          pointerId: 7,
        }),
      )
    finger('pointerdown', 250)
    finger('pointermove', 200)
    finger('pointermove', 100)
    finger('pointerup', 60)
    await gone(one.id)
  })
})
test('a swipe goes away past a third of the row and only when it is sideways', () => {
  expect(swipedAway(120, 4, 300)).toBe(true)
  expect(swipedAway(-120, 4, 300)).toBe(true)
  expect(swipedAway(90, 4, 300)).toBe(false)
  expect(swipedAway(120, 90, 300)).toBe(false)
})
