import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { priorityOf, priorityTone } from '../../tasks-model/src/api'
import type { Entry } from './entry'

const QuickAdd = (await import('./QuickAdd.svelte')).default
let target: HTMLDivElement
let drawn: ReturnType<typeof mount> | undefined
let handed: Entry[] = []
function shown(text = '') {
  target = document.createElement('div')
  document.body.append(target)
  drawn = mount(QuickAdd, {
    target,
    props: {
      langs: ['en'],
      tags: ['home', 'house', 'work'],
      prefill: { text },
      dictates: false,
      onsubmit: (entry: Entry) => {
        handed.push(entry)
        return true
      },
      onclose: () => undefined,
    },
  })
  flushSync()
}
const field = () => target.querySelector<HTMLInputElement>('input.field')!
const flag = () =>
  target.querySelector<HTMLButtonElement>('button[aria-label="Priority"]')?.style.getPropertyValue('color')
const chips = () => [...target.querySelectorAll<HTMLElement>('[data-chip]')].map((one) => one.textContent)
function type(words: string) {
  const input = field()
  input.value = words
  input.setSelectionRange(words.length, words.length)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
function press(key: string) {
  field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  flushSync()
}
async function add(): Promise<Entry | undefined> {
  target.querySelector<HTMLButtonElement>('button.add')?.click()
  await vi.waitFor(() => expect(handed).toHaveLength(1))
  return handed[0]
}
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 19, 10, 0), toFake: ['Date'] })
  handed = []
})
afterEach(() => {
  vi.useRealTimers()
  if (drawn) void unmount(drawn)
  target.remove()
})
test('the flag of p1 wears the tone of a high todo', () => {
  const high = priorityTone(3)
  expect(high).toBeTruthy()
  shown('Call mum p1')
  expect(flag()).toBe(high)
})
test('p4 leaves the flag uncoloured', () => {
  shown('Call mum p4')
  expect(flag()).toBe('')
})
test('a line read as a todo lights its chips and adds the todo they say', async () => {
  shown()
  type('Buy milk #home p1 tomorrow {30 nov}')
  expect(chips()).toEqual(['#home', 'p1', 'tomorrow', '{30 nov}'])
  const entry = await add()
  expect(entry?.text).toBe('Buy milk')
  expect(entry?.fields.tags).toEqual(['home'])
  expect(priorityOf(entry?.fields.priority)).toBe(3)
  expect(entry?.fields.due).toBe('2026-11-20')
  expect(entry?.fields.deadline).toBe('2026-11-30')
})
test('a todo typed with every repeats from its first day', async () => {
  shown()
  type('Water plants every day')
  expect(chips()).toEqual(['every day'])
  const entry = await add()
  expect(entry?.text).toBe('Water plants')
  expect(entry?.fields.recurrence).toBe('every day')
  expect(entry?.fields.due).toBe('2026-11-19')
})
test('a time a todo cannot keep stays in its title', async () => {
  shown()
  type('call at 4pm')
  expect(chips()).toEqual([])
  expect((await add())?.text).toBe('call at 4pm')
})
test('a chip turned back into words by Backspace is added as words', async () => {
  shown()
  type('Call mum tomorrow')
  expect(chips()).toEqual(['tomorrow'])
  press('Backspace')
  expect(chips()).toEqual([])
  const entry = await add()
  expect(entry?.text).toBe('Call mum tomorrow')
  expect(entry?.fields.due).toBeUndefined()
})
test('a label offered after # is taken with Enter, which adds nothing yet', async () => {
  shown()
  type('Buy bread #ho')
  const offered = [...target.querySelectorAll<HTMLElement>('[role="option"]')].map((one) => one.textContent.trim())
  expect(offered).toEqual(['#home', '#house'])
  press('Enter')
  expect(handed).toEqual([])
  expect(field().value).toBe('Buy bread #home ')
  expect((await add())?.fields.tags).toEqual(['home'])
})
