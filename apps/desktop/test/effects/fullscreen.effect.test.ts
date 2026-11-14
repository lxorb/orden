import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { closeOnBack } from '../../src/lib/ui-kit/src/backstack.svelte'
import { fullscreen } from '../../src/lib/fullscreen.svelte'
import { viewport } from '../../src/lib/ui-kit/src/viewport.svelte'
import { reactive, root, watch } from './runes.svelte'

beforeEach(() => {
  viewport.device = 'desktop'
})

function panes() {
  return reactive<{
    fills: string | null
    focusedId: string
    focused: { activeTabId: string | null }
  }>({
    fills: null,
    focusedId: 'left',
    focused: { activeTabId: 'a' },
  })
}

afterEach(async () => {
  await fullscreen.leave()
  viewport.device = 'desktop'
})

test('full screen follows the pane worked in, and settles every time', async () => {
  const two = panes()
  let runs = 0

  const stop = root(() => {
    watch(() => {
      runs++
      fullscreen.follow()
    })
  })

  flushSync()
  expect(runs).toBe(1)

  await fullscreen.enter(two)
  flushSync()
  expect(two.fills).toBe('left')
  expect(runs).toBe(2)

  two.focusedId = 'right'
  flushSync()
  expect(two.fills).toBe('right')
  expect(runs).toBe(4)

  two.focused.activeTabId = null
  flushSync()
  expect(fullscreen.on).toBe(false)
  expect(two.fills).toBe(null)
  expect(runs).toBe(6)

  stop()
})

test('on a phone, back leaves full screen rather than the app', async () => {
  viewport.device = 'phone'

  const stop = root(() => {
    watch(() => closeOnBack(fullscreen.on, () => void fullscreen.leave()))
  })

  flushSync()
  const before = history.length

  await fullscreen.enter(panes())
  flushSync()
  expect(history.length).toBe(before + 1)

  const heard = new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
  })
  history.back()
  await heard
  flushSync()

  expect(fullscreen.on).toBe(false)

  stop()
})

test('on a desktop, back means the previous page and nothing is registered', async () => {
  const stop = root(() => {
    watch(() => closeOnBack(fullscreen.on, () => void fullscreen.leave()))
  })

  flushSync()
  const before = history.length

  await fullscreen.enter(panes())
  flushSync()
  expect(fullscreen.on).toBe(true)
  expect(history.length).toBe(before)

  stop()
})
