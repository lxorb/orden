import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import DirText from './DirText.svelte'

const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'dir')
let sets = 0
beforeEach(() => {
  sets = 0
  Object.defineProperty(HTMLElement.prototype, 'dir', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('dir') ?? ''
    },
    set(this: HTMLElement, value: string) {
      sets++
      this.setAttribute('dir', value)
    },
  })
})
afterEach(() => {
  if (own) Object.defineProperty(HTMLElement.prototype, 'dir', own)
  document.body.replaceChildren()
})
test('a dir="auto" element is told its direction again only when its words change (#2290)', () => {
  const target = document.createElement('div')
  document.body.append(target)
  const shown: { say: (next: string) => void; light: () => void } = mount(DirText, { target })
  flushSync()
  expect(sets).toBe(0)
  shown.light()
  flushSync()
  shown.light()
  flushSync()
  expect(target.querySelector('p')?.className).not.toContain('lit')
  expect(sets).toBe(0)
  shown.say('سلام')
  flushSync()
  expect(sets).toBe(1)
  expect(target.querySelector('p')?.getAttribute('dir')).toBe('auto')
  shown.light()
  flushSync()
  expect(sets).toBe(1)
  void unmount(shown)
})
