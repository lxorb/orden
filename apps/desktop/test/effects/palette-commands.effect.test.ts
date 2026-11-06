import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { viewport } from '../../src/lib/viewport.svelte'

class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

const { overlays } = await import('../../src/lib/overlays')
const { default: Palette } = await import('../../src/lib/Palette.svelte')

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

Element.prototype.scrollIntoView = () => undefined

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

function palette(): { showCommands(): Promise<void> } {
  const made = mount(Palette, { target, props: { open: false } })
  flushSync()
  close = () => void unmount(made, { outro: false })

  return made as unknown as { showCommands(): Promise<void> }
}

const field = () => target.querySelector('input')

function type(text: string) {
  const input = field()
  if (!input) throw new Error('the palette has no field')

  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

test('opens on the commands, with the caret after the mark', async () => {
  const made = palette()
  expect(field()).toBeNull()

  await made.showCommands()
  flushSync()

  expect(field()?.value).toBe('>')
  expect(field()?.selectionStart).toBe(1)
  expect(field()?.selectionEnd).toBe(1)
})

test('puts the mark in front of what is already typed, and keeps the caret at the end', async () => {
  const made = palette()
  await made.showCommands()
  flushSync()

  type('fold')
  await made.showCommands()
  flushSync()

  expect(field()?.value).toBe('>fold')
  expect(field()?.selectionStart).toBe(5)
})

test('puts it there once, however often the key is pressed', async () => {
  const made = palette()
  await made.showCommands()
  flushSync()

  type('>fold')
  await made.showCommands()
  flushSync()
  await made.showCommands()
  flushSync()

  expect(field()?.value).toBe('>fold')
  expect(field()?.selectionStart).toBe(5)
})

test('starts empty after it has been closed', async () => {
  const made = palette()
  await made.showCommands()
  flushSync()

  type('>fold')
  overlays.escape()
  flushSync()

  await made.showCommands()
  flushSync()
  expect(field()?.value).toBe('>')
})

test('on a touch screen, is put away by the word beside the box', async () => {
  viewport.device = 'phone'
  try {
    const made = palette()
    await made.showCommands()
    flushSync()
    type('>fold')

    const give = target.querySelector<HTMLButtonElement>('button.give')
    expect(give?.textContent).toBe('Cancel')
    give?.click()
    flushSync()

    await made.showCommands()
    flushSync()
    expect(field()?.value).toBe('>')
  } finally {
    viewport.device = 'desktop'
  }
})

test('and on a desktop there is no such word, Escape being there', async () => {
  const made = palette()
  await made.showCommands()
  flushSync()

  expect(target.querySelector('button.give')).toBeNull()
})
