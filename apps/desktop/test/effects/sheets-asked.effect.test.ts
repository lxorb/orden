import { flushSync } from 'svelte'
import { beforeEach, expect, test } from 'vitest'
import { settings } from '../../src/lib/settings.svelte'
import { reactive, root, watch } from './runes.svelte'

/** The sheets, each fetched the first time something opens it.
 *
 *  None of the app's sheets is on screen when the window opens, so none of them is
 *  imported: App.svelte keeps one latch per sheet, sets it when the sheet's own store
 *  says the sheet is wanted, and never clears it. What is under test is that latch,
 *  because it is the thing that decides both halves of the bargain - a sheet nobody
 *  has opened costs nothing, and a sheet opened twice is fetched once and keeps the
 *  way in and out it had.
 *
 *  Three properties, all of them counted rather than timed. A sheet nobody asked for
 *  is not fetched. A sheet asked for is fetched once, however often it is opened and
 *  closed. And the effect does not wake itself: it writes the latches and reads only
 *  the stores, which is the shape said.svelte.ts got wrong - an effect that writes
 *  state it reads runs again, and this one has no guard to stop it with.
 *
 *  `settings` is the real store, because what opens the settings sheet is `show` -
 *  the section, the list on a phone, the error cleared - and the history sheet is a
 *  flag on the same store. The other four stand in as flags: what each of them opens
 *  is a component, and none of that is what this is about. */

/** The four sheets whose stores are not `settings`, as the one thing App.svelte reads
 *  off each: whether it is wanted. `icons` is a target rather than a flag in the app,
 *  which is the same question asked of an object. */
function stores() {
  return reactive({ share: false, publish: false, imports: false, icons: false })
}

/** The latch, as App.svelte holds it: one flag per sheet, set and never cleared. */
function latches() {
  return reactive({
    settings: false,
    history: false,
    share: false,
    publish: false,
    imports: false,
    icons: false,
  })
}

beforeEach(() => {
  settings.open = false
  settings.historyOpen = false
  settings.section = 'general'
  settings.listing = true
})

test('nothing is fetched for a sheet nobody has opened', () => {
  const open = stores()
  const asked = latches()
  let runs = 0

  const stop = root(() => {
    watch(() => {
      runs++
      if (settings.open) asked.settings = true
      if (settings.historyOpen) asked.history = true
      if (open.share) asked.share = true
      if (open.publish) asked.publish = true
      if (open.imports) asked.imports = true
      if (open.icons) asked.icons = true
    })
  })

  flushSync()
  expect(runs).toBe(1)
  expect(Object.values(asked).some((one) => one)).toBe(false)

  stop()
})

test('one sheet opening asks for that sheet and no other', () => {
  const open = stores()
  const asked = latches()

  const stop = root(() => {
    watch(() => {
      if (settings.open) asked.settings = true
      if (settings.historyOpen) asked.history = true
      if (open.share) asked.share = true
      if (open.publish) asked.publish = true
      if (open.imports) asked.imports = true
      if (open.icons) asked.icons = true
    })
  })

  flushSync()
  settings.show('editor')
  flushSync()

  expect(settings.section).toBe('editor')
  expect(settings.listing).toBe(false)
  expect(asked.settings).toBe(true)
  // The other five are still nothing: a reader who opened settings has not paid for
  // the version list, the share sheet or the icon picker.
  expect(asked).toStrictEqual({
    settings: true,
    history: false,
    share: false,
    publish: false,
    imports: false,
    icons: false,
  })

  stop()
})

test('a sheet closed and opened again is the sheet that is already here', () => {
  const open = stores()
  const asked = latches()
  /** How many times each latch went from false to true, which is how many times the
   *  `{#await}` behind it would fetch. */
  const fetches = { settings: 0, share: 0 }

  const stop = root(() => {
    watch(() => {
      if (settings.open && !asked.settings) fetches.settings++
      if (open.share && !asked.share) fetches.share++
      if (settings.open) asked.settings = true
      if (open.share) asked.share = true
    })
  })

  flushSync()
  settings.show()
  flushSync()
  open.share = true
  flushSync()
  expect(fetches).toStrictEqual({ settings: 1, share: 1 })

  // Both shut, which is what the app does when a reader presses Escape. The latches
  // hold, because a sheet unmounted the moment it closed would have no way out to
  // play.
  settings.open = false
  open.share = false
  flushSync()
  expect(asked.settings).toBe(true)
  expect(asked.share).toBe(true)

  // And opened again, twice each: still one fetch apiece.
  settings.show()
  flushSync()
  settings.open = false
  flushSync()
  settings.show()
  flushSync()
  open.share = true
  flushSync()
  open.share = false
  flushSync()
  open.share = true
  flushSync()

  expect(fetches).toStrictEqual({ settings: 1, share: 1 })

  stop()
})

test('the effect does not wake itself, however many latches it sets', () => {
  const open = stores()
  const asked = latches()
  let runs = 0

  const stop = root(() => {
    watch(() => {
      runs++
      if (settings.open) asked.settings = true
      if (settings.historyOpen) asked.history = true
      if (open.share) asked.share = true
      if (open.publish) asked.publish = true
      if (open.imports) asked.imports = true
      if (open.icons) asked.icons = true
    })
  })

  flushSync()
  expect(runs).toBe(1)

  // Every sheet opened at once. Six latches written in one run, and not one of them
  // is read by the effect that wrote it - so the run that set them is the last one.
  settings.open = true
  settings.historyOpen = true
  open.share = true
  open.publish = true
  open.imports = true
  open.icons = true
  flushSync()

  expect(runs).toBe(2)
  expect(Object.values(asked).every((one) => one)).toBe(true)

  stop()
})
