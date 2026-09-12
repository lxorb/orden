import { flushSync } from 'svelte'
import { beforeEach, expect, test } from 'vitest'
import { settings } from '../../src/lib/settings.svelte'
import { reactive, root, watch } from './runes.svelte'

/** The settings sheet, fetched the first time it is asked for.
 *
 *  App.svelte's effect reads two things - whether the sheet is open, and whether
 *  the panel has arrived - and writes the second of them. That is the shape
 *  said.svelte.ts got wrong: an effect that writes state it reads runs again, and
 *  the only reason this one stops is the guard on its first line. So the guard is
 *  what is under test, by counting: one fetch however often the sheet is opened,
 *  and a bounded number of runs.
 *
 *  `settings` is the real store, because what opens the sheet is `show` - the
 *  section, the list on a phone, the error cleared. The panel is a string: what the
 *  app fetches there is its largest single component, and none of it is what this is
 *  about. */

beforeEach(() => {
  settings.open = false
  settings.section = 'general'
  settings.listing = true
})

/** Two beats, which is what an `async` function's answer costs. */
async function answered(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

test('the sheet is fetched once, however often it is opened', async () => {
  const held = reactive<{ panel: string | null }>({ panel: null })
  let asked = 0
  let runs = 0

  const fetchSheet = async () => {
    asked++
    return 'the sheet'
  }

  const stop = root(() => {
    watch(() => {
      runs++
      if (!settings.open || held.panel) return

      void fetchSheet().then((one) => {
        held.panel = one
      })
    })
  })

  flushSync()
  expect(runs).toBe(1)
  // Nothing is fetched for a sheet nobody has asked for: that is the whole point
  // of the panel being lazy.
  expect(asked).toBe(0)

  settings.show('editor')
  flushSync()
  expect(settings.section).toBe('editor')
  expect(settings.listing).toBe(false)
  expect(asked).toBe(1)

  await answered()
  flushSync()
  expect(held.panel).toBe('the sheet')
  // Three runs: the first, the one the sheet opening woke, and the one the panel
  // arriving woke - which asks for nothing, because the panel is here.
  expect(runs).toBe(3)
  expect(asked).toBe(1)

  // Closed and opened again. The sheet is kept, so this is a second chance to
  // fetch it and there must not be one.
  settings.open = false
  flushSync()
  settings.show()
  flushSync()
  await answered()
  flushSync()

  expect(settings.listing).toBe(true)
  expect(asked).toBe(1)
  expect(runs).toBe(5)

  stop()
})
