import 'fake-indexeddb/auto'
import { providePort, registerCommand } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
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
afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
})
test('the panel opens the whole Todos tab from an Open chip before Show done', async () => {
  const ran: string[] = []
  const unregister = registerCommand('views.todos', () => Promise.resolve(() => void ran.push('todos')))
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(TodosPanel, { target })
  close = () => void unmount(view)
  flushSync()
  const chips = [...target.querySelectorAll<HTMLButtonElement>('.bar button.orden-chip')].map((one) =>
    one.textContent.trim(),
  )
  expect(chips.slice(0, 2)).toEqual(['Open', 'Show done'])
  target.querySelector<HTMLButtonElement>('[data-todos-open]')?.click()
  await new Promise((done) => setTimeout(done, 0))
  expect(ran).toEqual(['todos'])
  unregister()
})
