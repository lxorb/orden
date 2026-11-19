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
afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
})
test.each([
  ['panel', TodosPanel],
  ['board', TodosBoard],
])('Delete todo in the open todo of the %s deletes it and closes the sheet', async (_, View) => {
  const made = await addTask(`Water the plants ${String(Math.random())}`, { typed: false })
  if (!made) throw new Error('no todo')
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(View, { target })
  close = () => void unmount(shown)
  flushSync()
  const row = () => target.querySelector(`[data-todo="${made.id}"]`)
  row()?.querySelector<HTMLButtonElement>('button.body')?.click()
  flushSync()
  const remove = [...target.querySelectorAll('button')].find((one) => one.textContent.trim() === 'Delete todo')
  if (!remove) throw new Error('no Delete todo')
  remove.click()
  flushSync()
  await vi.waitFor(() => expect(todos.todo(made.id)).toBeNull())
  flushSync()
  expect(row()).toBeNull()
  expect([...target.querySelectorAll('button')].some((one) => one.textContent.trim() === 'Delete todo')).toBe(false)
})
