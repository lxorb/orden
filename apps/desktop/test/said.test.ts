import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { said } from '../src/lib/said.svelte'

/** The one live region the app announces anything through, and the one thing it
 *  must never do: read the state it writes.
 *
 *  `say` is called from an `$effect` - App.svelte turns the sync light and a tab's
 *  save dot into words there. A reactive read inside an effect is a dependency, so
 *  a `say` that read `words` made every caller an effect that depends on the very
 *  state it writes; and the empty-then-restore that makes a live region repeat
 *  itself then wrote that dependency twice per call. The effect ran again, said the
 *  same thing again, and a thousand rounds later Svelte abandoned the batch with
 *  `effect_update_depth_exceeded` - after which nothing in the page updates again:
 *  the app is fully drawn and answers no click, so the space switcher does not open
 *  and a note has no menu. That is what was reported from an installed build on
 *  2026-09-12.
 *
 *  What is asserted here is the rule that prevents it: every decision `say` makes
 *  is made from what `say` itself last wrote, never from the region. The whole page
 *  going through the loop is `test/e2e/said-loop.py`, which needs a browser; this
 *  needs none. */

beforeEach(() => {
  vi.useFakeTimers()
  // A known resting state: whatever an earlier test said has timed out.
  vi.runAllTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

describe('the live region', () => {
  test('carries what it was told, and empties itself after a while', () => {
    said.say('Syncing')
    expect(said.words).toBe('Syncing')

    vi.advanceTimersByTime(4000)
    expect(said.words).toBe('')
  })

  test('says the same thing twice, which means emptying first', async () => {
    said.say('Sync failed')
    expect(said.words).toBe('Sync failed')

    said.say('Sync failed')
    expect(said.words).toBe('')
    await Promise.resolve()
    expect(said.words).toBe('Sync failed')
  })

  test('has nothing to say about nothing', () => {
    said.say('Saved')
    said.say('   ')
    expect(said.words).toBe('Saved')
  })

  test('never puts an older sentence back over a newer one', async () => {
    said.say('Saving')
    // The same words again, which schedules the restore a beat later.
    said.say('Saving')
    // And something newer before that beat arrives.
    said.say('Saved')

    await Promise.resolve()
    expect(said.words).toBe('Saved')
  })

  /** The one that matters. `say` used to ask the region whether it had already
   *  said this; the region is state, and asking it is what made every caller
   *  depend on it. It asks what it last wrote instead - which nothing can depend
   *  on - so a write from anywhere else cannot change its mind. */
  test('decides by what it last wrote, not by what the region holds', async () => {
    said.say('Syncing')
    expect(said.words).toBe('Syncing')

    // Exactly what the loop used to do between two runs of one effect.
    said.words = 'something else entirely'

    said.say('Syncing')
    // Still the repeat: it knows it said this, whatever the region says now.
    expect(said.words).toBe('')
    await Promise.resolve()
    expect(said.words).toBe('Syncing')
  })
})
