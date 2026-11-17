import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const { hints } = await import('./hints.svelte')
const HintCard = (await import('./HintCard.svelte')).default

let target: HTMLElement
let below: HTMLInputElement
let close: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  hints.restore()
  target = document.createElement('div')
  target.style.position = 'relative'
  below = document.createElement('input')
  document.body.append(target, below)
  const shown = mount(HintCard, {
    target,
    props: { hint: 'palette', text: 'Press Shift Shift to find anything', side: 'below' },
    intro: false,
  })
  close = () => void unmount(shown)
  flushSync()
  hints.settle()
  flushSync()
})

afterEach(() => {
  close?.()
  target.remove()
  below.remove()
})

const bubble = () => document.querySelector('.hint')

describe('a hint bubble', () => {
  test('steps aside the moment the reader presses anything else, without being put away for good', () => {
    expect(bubble()).not.toBeNull()

    below.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    flushSync()

    expect(hints.current).toBeNull()
    expect(hints.seen).not.toContain('palette')
  })

  test('steps aside when the reader types somewhere else', () => {
    below.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    flushSync()

    expect(hints.current).toBeNull()
  })

  test('stays while the reader presses the bubble itself', () => {
    bubble()
      ?.querySelector('.say')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    flushSync()

    expect(hints.current).toBe('palette')
  })
})
