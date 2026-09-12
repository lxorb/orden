import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { closeOnBack } from '../../src/lib/backstack.svelte'
import { fullscreen } from '../../src/lib/fullscreen.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { reactive, root, watch } from './runes.svelte'

/** Two of App.svelte's effects about the screen with nothing on it but the
 *  document, both of which are a store method called from an effect.
 *
 *  `fullscreen.watch` is the shape said.svelte.ts got wrong: it reads the state it
 *  writes. Called from an effect, `on` and `of` become that effect's dependencies
 *  and `leave()` then writes both - so the effect runs again, and the only reason
 *  it stops is the guard on the first line. What is asserted here is that it does
 *  stop, and in how many runs: src/lib/fullscreen.test.ts calls the same method by
 *  hand, which cannot tell a store that settles from one that would not.
 *
 *  `closeOnBack` is the other half: an effect whose teardown is a layer of history
 *  given back, which wants a real `history` and a real popstate to be honest
 *  about. Neither needs a window measured or a pixel painted. */

beforeEach(() => {
  viewport.device = 'desktop'
})

afterEach(async () => {
  await fullscreen.leave()
  viewport.device = 'desktop'
})

test('a document closed while it is full screen brings the app back, once', async () => {
  const open = reactive<{ ids: string[] }>({ ids: ['a', 'b'] })
  let runs = 0

  const stop = root(() => {
    watch(() => {
      runs++
      fullscreen.watch(open.ids)
    })
  })

  flushSync()
  expect(runs).toBe(1)

  await fullscreen.enter('a')
  flushSync()
  expect(fullscreen.on).toBe(true)
  // Entering wrote `on` and `of`, which the effect read through `watch`.
  expect(runs).toBe(2)

  // The tab it belongs to, closed from somewhere else.
  open.ids = ['b']
  flushSync()
  expect(fullscreen.on).toBe(false)
  expect(fullscreen.of).toBe(null)

  // Two more runs and no more: the one that found the tab gone, and the one the
  // leaving woke, which found nothing left to do. A method that decided from the
  // state it writes - said.svelte.ts's bug - is how this becomes a thousand.
  expect(runs).toBe(4)

  stop()
})

test('on a phone, back leaves full screen rather than the app', async () => {
  viewport.device = 'phone'

  const stop = root(() => {
    watch(() => closeOnBack(fullscreen.on, () => void fullscreen.leave()))
  })

  flushSync()
  const before = history.length

  // A layer that is open takes an entry, so back has something of its own to
  // answer.
  await fullscreen.enter('a')
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

  await fullscreen.enter('a')
  flushSync()
  expect(fullscreen.on).toBe(true)
  expect(history.length).toBe(before)

  stop()
})
