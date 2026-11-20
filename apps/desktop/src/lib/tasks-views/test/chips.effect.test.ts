import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
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
const VIEWS = [
  ['panel', TodosPanel, ['data-todos-open', 'data-todos-show-done', 'data-todos-label', 'data-todos-group']],
  [
    'board',
    TodosBoard,
    ['data-todos-show-done', 'data-todos-any-start', 'data-todos-label', 'data-todos-group', 'data-todos-sort'],
  ],
] as const
function shown(View: (typeof VIEWS)[number][1]) {
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(View, { target })
  close = () => void unmount(view)
  flushSync()
  return target
}
test.each(VIEWS)('every control in the %s toolbar is a chip button', (_, View, marks) => {
  const target = shown(View)
  for (const mark of marks) {
    const one = target.querySelector(`[${mark}]`)
    expect(one?.tagName, mark).toBe('BUTTON')
    expect(one?.classList.contains('orden-chip'), mark).toBe(true)
  }
})
const PICKS = [
  ['Group in the panel', TodosPanel, 'data-todos-group', 'Group'],
  ['Sort on the board', TodosBoard, 'data-todos-sort', 'Sort'],
] as const
test.each(PICKS)('%s is a chip that names its choice and opens its list', async (_, View, mark, name) => {
  const target = shown(View)
  const chip = () => target.querySelector<HTMLButtonElement>(`[${mark}]`)
  expect(chip()?.getAttribute('role')).toBe('combobox')
  expect(chip()?.textContent.replace(/\s+/g, ' ').trim()).toMatch(new RegExp(`^${name} \\S`))
  chip()?.click()
  flushSync()
  const options = () => [...document.querySelectorAll<HTMLButtonElement>('[role="listbox"] [role="option"]')]
  expect(options().map((one) => one.textContent.trim())).toContain('Priority')
  options()
    .find((one) => one.textContent.trim() === 'Priority')
    ?.click()
  flushSync()
  expect(document.querySelector('[role="listbox"]')).toBeNull()
  await vi.waitFor(() => {
    flushSync()
    expect(chip()?.textContent).toContain('Priority')
  })
})
