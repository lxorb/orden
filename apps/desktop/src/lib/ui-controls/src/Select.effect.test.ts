import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const Select = (await import('./Select.svelte')).default

const OPTIONS = [
  { value: 'simplelogin', label: 'SimpleLogin' },
  { value: 'addy', label: 'addy.io' },
]

let card: HTMLElement
let close: (() => void) | undefined
const onchange = vi.fn()

beforeEach(() => {
  card = document.createElement('div')
  card.style.overflow = 'hidden'
  document.body.append(card)
  const shown = mount(Select, {
    target: card,
    props: { value: 'simplelogin', options: OPTIONS, label: 'Alias service', onchange },
    intro: false,
  })
  close = () => void unmount(shown)
})

afterEach(() => {
  close?.()
  card.remove()
  onchange.mockReset()
})

test('the open list hangs outside the card that would clip it, and still chooses', () => {
  const trigger = card.querySelector<HTMLButtonElement>('[role="combobox"]')
  trigger?.click()
  flushSync()

  const list = document.querySelector<HTMLElement>('[role="listbox"]')
  expect(list).not.toBeNull()
  expect(card.contains(list)).toBe(false)
  expect(list?.style.position).toBe('fixed')
  expect(trigger?.getAttribute('aria-expanded')).toBe('true')

  const addy = [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find((one) =>
    one.textContent.includes('addy.io'),
  )
  addy?.click()
  flushSync()
  expect(onchange).toHaveBeenCalledWith('addy')
  expect(trigger?.getAttribute('aria-expanded')).toBe('false')
})
