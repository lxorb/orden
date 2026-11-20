import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addTask, dayAfter, dayOf, todos } from '../../tasks-model/src/api'
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
beforeAll(async () => {
  const made = await addTask('Warm up', { typed: false })
  if (made) await todos.remove(made.id)
})
afterEach(async () => {
  close?.()
  close = undefined
  document.body.replaceChildren()
  await Promise.all(todos.todos.map((one) => todos.remove(one.id)))
})
function shown(View: typeof TodosPanel) {
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(View, { target })
  close = () => void unmount(view)
  flushSync()
  return target
}
function type(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error('no field')
  input.focus()
  input.value = value
  input.setSelectionRange(value.length, value.length)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
function send(input: HTMLInputElement | null) {
  input?.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  flushSync()
}
const held = async (title: string) => {
  await vi.waitFor(() => expect(todos.todos.some((one) => one.title.startsWith(title))).toBe(true))
  return todos.todos.find((one) => one.title.startsWith(title))
}
const today = () => dayOf()
const november = () => `${today().slice(0, 4)}-11-30`
describe('a todo typed in Todoist style', () => {
  test('in the panel keeps its title and takes its label, priority, start and deadline, and the words light up', async () => {
    const target = shown(TodosPanel)
    const field = target.querySelector<HTMLInputElement>('[data-todos-add]')
    type(field, 'Buy milk #home p1 tomorrow {30 nov}')
    expect([...target.querySelectorAll('[data-chip]')].map((one) => one.textContent)).toEqual([
      '#home',
      'p1',
      'tomorrow',
      '{30 nov}',
    ])
    send(field)
    const made = await held('Buy milk')
    expect(made).toMatchObject({ title: 'Buy milk', priority: 3, start: dayAfter(today(), 1) })
    expect(made?.labels).toContain('home')
    if (today() <= november()) expect(made?.deadline).toBe(november())
    expect(field?.value).toBe('')
  })
  test('in the panel a rule typed after the title makes it repeat', async () => {
    const target = shown(TodosPanel)
    const field = target.querySelector<HTMLInputElement>('[data-todos-add]')
    type(field, 'Cut nails every! 10 days')
    send(field)
    const made = await held('Cut nails')
    expect(made).toMatchObject({ title: 'Cut nails', repeat: 'every 10 days when done' })
  })
  test('a word given back with Backspace stays in the title', async () => {
    const target = shown(TodosPanel)
    const field = target.querySelector<HTMLInputElement>('[data-todos-add]')
    type(field, 'Read tomorrow')
    field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    flushSync()
    send(field)
    const made = await held('Read')
    expect(made?.title).toBe('Read tomorrow')
    expect(made?.start).toBeNull()
  })
  test('a sign offers the labels there are', async () => {
    await addTask('Old one', { typed: false })
    const one = todos.todos.find((todo) => todo.title === 'Old one')
    if (one) await todos.update(one.id, { labels: ['home', 'work'] })
    const target = shown(TodosPanel)
    const field = target.querySelector<HTMLInputElement>('[data-todos-add]')
    type(field, 'Call #ho')
    await vi.waitFor(() =>
      expect([...target.querySelectorAll('[role="option"]')].map((option) => option.textContent.trim())).toEqual([
        'home',
      ]),
    )
  })
  test('in a board column it takes the column and what was typed, the typed priority winning', async () => {
    const target = shown(TodosBoard)
    const add = target.querySelector<HTMLButtonElement>('[data-todos-column-add]')
    add?.click()
    await vi.waitFor(() => expect(target.querySelector('[data-todos-column-field]')).not.toBeNull())
    const field = target.querySelector<HTMLInputElement>('[data-todos-column-field]')
    type(field, 'Buy milk #home p1 tomorrow {30 nov}')
    send(field)
    const made = await held('Buy milk')
    expect(made).toMatchObject({ title: 'Buy milk', priority: 3, start: dayAfter(today(), 1) })
    expect(made?.labels).toContain('home')
  })
})
