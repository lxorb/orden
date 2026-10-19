/** The first run's optional questions, on the page: the card says the reader is all set,
 *  asks one question at a time when asked, applies each answer at once, and goes with
 *  Done at any of them. See Personalize.svelte.
 *
 *  In the jsdom project because it mounts a component. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Personalize from '../../src/lib/Personalize.svelte'
import { modes } from '../../src/lib/modes.svelte'
import { settings } from '../../src/lib/settings.svelte'

/** jsdom has no animations, and the card flies in. */
Element.prototype.animate = () => {
  const animation = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  setTimeout(() => animation.onfinish?.(), 0)
  return animation as unknown as Animation
}

let host: HTMLElement
let shown: ReturnType<typeof mount> | undefined

beforeEach(() => {
  localStorage.clear()
  modes.developer = null
  if (modes.quietMarks) modes.toggleQuietMarks()
  settings.setup = -1
  host = document.createElement('div')
  document.body.append(host)
  shown = mount(Personalize, { target: host })
  flushSync()
})

afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = undefined
  settings.setup = null
  host.remove()
})

const words = () => [...host.querySelectorAll('button')].map((one) => one.textContent.trim())

function press(word: string) {
  const button = [...host.querySelectorAll('button')].find((one) => one.textContent.trim() === word)
  if (!button) throw new Error(`no ${word} in ${words().join(', ')}`)
  button.click()
  flushSync()
}

test('says all set, and asks the questions one at a time when asked', async () => {
  expect(words()).toContain('Personalize')

  press('Personalize')
  expect(settings.setup).toBe(0)

  press('Next')
  press('Yes')
  expect(modes.developer).toBe(true)
  press('Next')
  expect(settings.setup).toBe(2)
  // A yes starts markdown the way Obsidian's live preview writes it.
  expect(host.querySelector('[aria-checked="true"]')?.textContent.trim()).toBe('Live preview')

  press('Clean')
  expect(modes.quietMarks).toBe(true)
  press('Next')

  expect(settings.setup).toBeNull()
  await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).toBeNull())
})

test('Done at any question leaves the rest at their defaults', async () => {
  press('Personalize')
  press('Done')

  expect(modes.developer).toBeNull()
  expect(modes.coder).toBe(true)
  await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).toBeNull())
})
