import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { addTask, dayAfter, dayOf, todos } from '../../tasks-model/src/api'
import { undoToast } from '../../undo-toast/src/api'
import { TodosPanel } from '../src/api'

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
  undoToast.dismiss()
  document.body.replaceChildren()
  await Promise.all(todos.todos.map((one) => todos.remove(one.id)))
})
function shown() {
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(TodosPanel, { target })
  close = () => void unmount(view)
  flushSync()
  return target
}
test('a repeat set in the sheet shows on the row', async () => {
  const made = await addTask('Water the plants', { typed: false })
  const target = shown()
  const row = () => target.querySelector<HTMLElement>(`[data-todo="${made?.id ?? ''}"]`)
  row()?.querySelector<HTMLButtonElement>('button.body')?.click()
  flushSync()
  const field = target.querySelector<HTMLInputElement>('[data-todo-editor] input[aria-label="Repeat"]')
  if (!field) throw new Error('no repeat field')
  field.value = 'every! 3 days'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(todos.todo(made?.id ?? '')?.repeat).toBe('every 3 days when done'))
  flushSync()
  expect(row()?.querySelector('[data-repeat]')?.textContent.trim()).toBe('every 3 days after done')
})
test('ticking a repeating row moves its date and keeps it in the list, and Undo puts it back', async () => {
  const made = await addTask('Pay rent', { typed: false })
  const id = made?.id ?? ''
  const deadline = dayAfter(dayOf(), -3)
  await todos.update(id, { repeat: 'every week', deadline })
  const target = shown()
  const tick = target.querySelector<HTMLInputElement>(`[data-todo="${id}"] .tick`)
  if (!tick) throw new Error('no tick')
  tick.checked = true
  tick.dispatchEvent(new Event('change', { bubbles: true }))
  await vi.waitFor(() => expect(todos.todo(id)?.deadline).toBe(dayAfter(deadline, 7)))
  expect(todos.todo(id)?.done).toBe(false)
  flushSync()
  expect(target.querySelector(`[data-todo="${id}"]`)).not.toBeNull()
  await vi.waitFor(() => expect(undoToast.own?.said).toBe('done'))
  await undoToast.own?.undo()
  await vi.waitFor(() => expect(todos.todo(id)?.deadline).toBe(deadline))
  expect(todos.todos.filter((one) => one.title === 'Pay rent')).toHaveLength(1)
})
