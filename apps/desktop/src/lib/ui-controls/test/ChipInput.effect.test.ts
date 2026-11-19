import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const ChipHost = (await import('./ChipHost.svelte')).default
let close: (() => void) | undefined
let target: HTMLElement
const onkey = vi.fn()
function shown(start: string) {
  target = document.createElement('div')
  document.body.append(target)
  const host = mount(ChipHost, { target, props: { start, onkey } })
  close = () => void unmount(host)
  flushSync()
}
afterEach(() => {
  close?.()
  target.remove()
  onkey.mockReset()
})
const field = () => target.querySelector<HTMLInputElement>('input[data-host]')!
const chips = () => [...target.querySelectorAll<HTMLElement>('[data-chip]')].map((one) => one.textContent)
const kept = () => JSON.parse(target.querySelector('output')?.dataset.kept ?? '[]') as unknown
const text = () => target.querySelector('output')?.textContent
const options = () => [...target.querySelectorAll<HTMLElement>('[role="option"]')]
function type(value: string, caret = value.length) {
  const input = field()
  input.value = value
  input.setSelectionRange(caret, caret)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  field().dispatchEvent(event)
  flushSync()
  return event
}

test('the words the consumer reads light up as chips', () => {
  shown('Call mum tomorrow #home')
  expect(chips()).toEqual(['tomorrow', '#home'])
  expect(field().getAttribute('aria-label')).toBe('Add todo')
})
test('a sign offers names, the arrows walk them, and Enter takes one without passing on', () => {
  shown('')
  type('Call #fa')
  expect(options().map((one) => one.textContent.trim())).toEqual(['family', 'farm'])
  expect(field().getAttribute('aria-expanded')).toBe('true')
  press('ArrowDown')
  expect(options()[1]?.getAttribute('aria-selected')).toBe('true')
  expect(press('Enter').defaultPrevented).toBe(true)
  expect(text()).toBe('Call #farm ')
  expect(onkey).not.toHaveBeenCalled()
  expect(options()).toEqual([])
})
test('Escape puts the offers away and the next Enter goes to the consumer', () => {
  shown('')
  type('Call #fa')
  press('Escape')
  expect(options()).toEqual([])
  press('Enter')
  expect(onkey).toHaveBeenCalledTimes(1)
})
test('Backspace at the end of a chip turns it back into words, the next one deletes', () => {
  shown('')
  type('Call tomorrow')
  expect(chips()).toEqual(['tomorrow'])
  expect(press('Backspace').defaultPrevented).toBe(true)
  expect(text()).toBe('Call tomorrow')
  expect(chips()).toEqual([])
  expect(kept()).toEqual([{ from: 5, to: 13 }])
  expect(press('Backspace').defaultPrevented).toBe(false)
  expect(onkey).toHaveBeenCalledTimes(1)
})
test('a span kept as words moves with what is typed before it', () => {
  shown('')
  type('Call tomorrow')
  press('Backspace')
  type('Now Call tomorrow', 3)
  expect(kept()).toEqual([{ from: 9, to: 17 }])
  expect(chips()).toEqual([])
})
