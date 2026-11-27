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
test.each([
  ['panel', TodosPanel],
  ['board', TodosBoard],
])(
  'ticking a todo twice in the %s keeps the box, the strike and the stored value together (#2588)',
  async (_, View) => {
    const made = await addTask(`Spca lecture ${String(Math.random())}`, { typed: false })
    if (!made) throw new Error('no todo')
    const target = document.createElement('div')
    document.body.append(target)
    const view = mount(View, { target })
    close = () => void unmount(view)
    flushSync()
    const row = () => target.querySelector<HTMLElement>(`[data-todo="${made.id}"]`)
    const box = () => row()?.querySelector<HTMLInputElement>('input.tick') ?? null
    for (const done of [true, false]) {
      box()?.click()
      await vi.waitFor(() => {
        flushSync()
        expect(todos.todo(made.id)?.done).toBe(done)
      })
      flushSync()
      if (row()) {
        expect(box()?.checked, `box after ${String(done)}`).toBe(done)
        expect(row()?.querySelector('.todo')?.classList.contains('done') ?? row()?.classList.contains('done')).toBe(
          done,
        )
      }
    }
  },
)
