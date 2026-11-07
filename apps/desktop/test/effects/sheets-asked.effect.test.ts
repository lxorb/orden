import { flushSync } from 'svelte'
import { beforeEach, expect, test } from 'vitest'
import { settings } from '../../src/lib/settings.svelte'
import { reactive, root, watch } from './runes.svelte'

function stores() {
  return reactive({ settings: false, share: false, publish: false, imports: false, icons: false })
}

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
  settings.historyOpen = false
})

test('nothing is fetched for a sheet nobody has opened', () => {
  const open = stores()
  const asked = latches()
  let runs = 0

  const stop = root(() => {
    watch(() => {
      runs++
      if (open.settings) asked.settings = true
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
      if (open.settings) asked.settings = true
      if (settings.historyOpen) asked.history = true
      if (open.share) asked.share = true
      if (open.publish) asked.publish = true
      if (open.imports) asked.imports = true
      if (open.icons) asked.icons = true
    })
  })

  flushSync()
  settings.historyOpen = true
  flushSync()

  expect(asked).toStrictEqual({
    settings: false,
    history: true,
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
  const fetches = { settings: 0, share: 0 }

  const stop = root(() => {
    watch(() => {
      if (open.settings && !asked.settings) fetches.settings++
      if (open.share && !asked.share) fetches.share++
      if (open.settings) asked.settings = true
      if (open.share) asked.share = true
    })
  })

  flushSync()
  open.settings = true
  flushSync()
  open.share = true
  flushSync()
  expect(fetches).toStrictEqual({ settings: 1, share: 1 })

  open.settings = false
  open.share = false
  flushSync()
  expect(asked.settings).toBe(true)
  expect(asked.share).toBe(true)

  open.settings = true
  flushSync()
  open.settings = false
  flushSync()
  open.settings = true
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
      if (open.settings) asked.settings = true
      if (settings.historyOpen) asked.history = true
      if (open.share) asked.share = true
      if (open.publish) asked.publish = true
      if (open.imports) asked.imports = true
      if (open.icons) asked.icons = true
    })
  })

  flushSync()
  expect(runs).toBe(1)

  open.settings = true
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
