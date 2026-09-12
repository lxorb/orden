import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { said } from '../../src/lib/said.svelte'
import Announcing from './Announcing.svelte'
import { reactive, root, watch } from './runes.svelte'

/** The bug this project exists for, driven the way the app drives it.
 *
 *  `say` is called from an `$effect`: App.svelte turns the sync light and a tab's
 *  save dot into words. A reactive read inside an effect is a dependency, so a
 *  `say` that read `words` to decide whether it had already said this made every
 *  caller an effect that depended on the state it wrote - and the empty-then-
 *  restore that is the only way to make a live region repeat itself then wrote
 *  that dependency twice per call. The effect ran again, said the same thing
 *  again, and a thousand rounds later Svelte abandoned the batch with
 *  `effect_update_depth_exceeded`, after which the page is fully drawn and never
 *  updates again: no menu opens, no space can be chosen. That is what reached an
 *  installed build on 2026-09-12.
 *
 *  test/said.test.ts drives `say` by hand and asserts the rule it now follows.
 *  Neither it nor any other test in the node project could have caught this,
 *  because `environment: 'node'` compiles a rune for the server and there is no
 *  `$effect` there at all. This is the same store with an effect watching it. */

let target: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  // A known resting state: whatever an earlier test said has timed out, so the
  // region is empty and `say` has nothing it thinks it already said.
  vi.runAllTimers()

  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  target.remove()
  vi.runAllTimers()
  vi.useRealTimers()
})

/** What the region is carrying, read off the page rather than off the store. */
function region(): string {
  return target.querySelector('[data-said]')?.textContent ?? ''
}

test('the same thing said twice from an effect leaves the page still updating', async () => {
  const props = reactive<{ status: 'idle' | 'syncing' | 'error'; saving: 'idle' | 'saving' }>({
    status: 'idle',
    saving: 'idle',
  })
  const app = mount(Announcing, { target, props })
  flushSync()
  expect(region()).toBe('')

  // A pass that failed. One announcement, and the effect settles.
  props.status = 'error'
  flushSync()
  expect(region()).toBe('Sync failed')

  // The same pass failing again, which is the same words again: the region is
  // emptied and they go back a beat later. Every write in that dance used to
  // wake the effect that asked for it.
  props.status = 'idle'
  flushSync()
  props.status = 'error'
  expect(() => flushSync()).not.toThrow()
  expect(region()).toBe('')

  await Promise.resolve()
  flushSync()
  expect(region()).toBe('Sync failed')

  // And the half of the bug that is not about the region at all: a page that has
  // thrown is drawn and dead, so something with nothing to do with `said` has to
  // still reach the DOM.
  props.saving = 'saving'
  flushSync()
  expect(target.querySelector('[data-saving]')?.textContent).toBe('saving')

  void unmount(app)
})

test('an effect that says the same thing runs once per change, not a thousand times', () => {
  const driver = reactive({ passes: 0 })
  /** Which pass each run of the effect saw: one entry per run. */
  const seen: number[] = []

  const stop = root(() => {
    watch(() => {
      seen.push(driver.passes)
      said.say('Sync failed')
    })
  })

  flushSync()
  expect(seen).toEqual([0])
  expect(said.words).toBe('Sync failed')

  // A second pass that failed the same way. One more run, and no more: what `say`
  // writes is not something the effect that called it can depend on.
  driver.passes++
  flushSync()
  expect(seen).toEqual([0, 1])

  stop()
})
