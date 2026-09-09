import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Frame, MOVE, SNAP } from './frame.svelte'

/** The card on the note: following a finger, or springing into place.
 *
 *  The screenshot Emil sent is a card, not an outline, and the thing a card has to
 *  get right is when it moves. Following while the finger drags, springing when it
 *  lets go, and never easing its way down a scroll - which is a card that lags
 *  behind the words it is supposed to be around. */

let frame: Frame

beforeEach(() => {
  vi.useFakeTimers()
  frame = new Frame()
})

afterEach(() => {
  frame.stop()
  vi.useRealTimers()
})

describe('the card', () => {
  test('is still until something moves', () => {
    expect(frame.moving).toBe(false)
    expect(frame.covered).toBe(false)
  })

  test('follows the words while the finger is dragging', () => {
    frame.scrolled()
    expect(frame.moving).toBe(false)

    // Every frame of a drag is another scroll, and none of them springs.
    for (let at = 0; at < 20; at++) {
      vi.advanceTimersByTime(16)
      frame.scrolled()
      expect(frame.moving).toBe(false)
    }
  })

  test('springs into place once it has let go', () => {
    frame.scrolled()

    vi.advanceTimersByTime(SNAP - 1)
    expect(frame.moving).toBe(false)
    vi.advanceTimersByTime(2)
    expect(frame.moving).toBe(true)
  })

  test('and is still again when the spring is over', () => {
    frame.scrolled()
    vi.advanceTimersByTime(SNAP + MOVE - 1)
    expect(frame.moving).toBe(true)

    vi.advanceTimersByTime(2)
    expect(frame.moving).toBe(false)
  })

  test('a scroll during the spring goes back to following', () => {
    frame.scrolled()
    vi.advanceTimersByTime(SNAP + 10)
    expect(frame.moving).toBe(true)

    frame.scrolled()
    expect(frame.moving).toBe(false)
  })

  test('springs at once when the page turned, because nothing is dragging', () => {
    frame.turned()
    expect(frame.moving).toBe(true)

    vi.advanceTimersByTime(MOVE + 1)
    expect(frame.moving).toBe(false)
  })

  test('a page that turns while a drag is settling springs once, not twice', () => {
    frame.scrolled()
    frame.turned()
    expect(frame.moving).toBe(true)

    // The drag's own spring was cancelled by the turn: after one spring's time it is
    // still rather than starting again.
    vi.advanceTimersByTime(MOVE + SNAP + 10)
    expect(frame.moving).toBe(false)
  })

  test('stops moving when the plugin goes away', () => {
    frame.turned()
    frame.stop()

    expect(frame.moving).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(frame.moving).toBe(false)
  })
})
