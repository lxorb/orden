import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { prompt } from '../../ui-kit/src/api'

const SheetPrompt = (await import('./SheetPrompt.svelte')).default
let shown: ReturnType<typeof mount> | undefined
afterEach(() => {
  prompt.dismiss()
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})
function host() {
  shown = mount(SheetPrompt, { target: document.body })
}
const field = () => document.querySelector<HTMLInputElement>('[data-sheet-prompt] input')
const confirm = () => document.querySelector<HTMLButtonElement>('[data-sheet-confirm]')
function typed(words: string) {
  const input = field()
  if (!input) throw new Error('no field')
  input.value = words
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
test('a question is asked in a sheet with a named field, and answered by its button or by Enter', async () => {
  host()
  const said = prompt.ask({ title: 'Daily goal', value: '0:30', placeholder: '1:30', confirmLabel: 'Save' })
  flushSync()
  expect(document.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Daily goal')
  expect([field()?.getAttribute('aria-label'), field()?.value, field()?.placeholder]).toEqual([
    'Daily goal',
    '0:30',
    '1:30',
  ])
  expect(confirm()?.textContent.trim()).toBe('Save')
  typed('   ')
  expect(confirm()?.disabled).toBe(true)
  typed('1:30')
  document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  expect(await said).toBe('1:30')
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull())
})
test('a yes or no is confirmed by its button and refused by Cancel or Escape', async () => {
  host()
  const sure = prompt.confirm({ title: 'Delete 2 todos?', confirmLabel: 'Delete', danger: true })
  flushSync()
  expect(field()).toBeNull()
  expect(confirm()?.classList.contains('is-danger')).toBe(true)
  confirm()?.click()
  expect(await sure).toBe(true)
  const again = prompt.confirm({ title: 'Delete 2 todos?' })
  flushSync()
  ;[...document.querySelectorAll<HTMLButtonElement>('[data-sheet-prompt] button')]
    .find((one) => one.textContent.trim() === 'Cancel')
    ?.click()
  expect(await again).toBe(false)
  const third = prompt.confirm({ title: 'Delete 2 todos?' })
  flushSync()
  document.querySelector('[role=dialog]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(await third).toBe(false)
})
test('one of several is chosen by its row, and a long list is narrowed by typing', async () => {
  host()
  const picked = prompt.choose({
    title: 'Move to',
    options: [
      { id: 'a', label: 'Work' },
      { id: 'b', label: 'Home' },
    ],
  })
  flushSync()
  expect([...document.querySelectorAll('[data-sheet-option]')].map((one) => one.textContent.trim())).toEqual([
    'Work',
    'Home',
  ])
  document.querySelector<HTMLButtonElement>('[data-sheet-option="b"]')?.click()
  expect(await picked).toBe('b')
  const found = prompt.find({
    title: 'Label',
    options: [
      { id: 'a', label: 'Work' },
      { id: 'b', label: 'Home' },
    ],
  })
  flushSync()
  typed('ho')
  expect([...document.querySelectorAll('[data-sheet-option]')].map((one) => one.textContent.trim())).toEqual(['Home'])
  document.querySelector<HTMLButtonElement>('[data-sheet-option="b"]')?.click()
  expect(await found).toBe('b')
})
