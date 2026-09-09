import { describe, expect, test } from 'vitest'
import { overlays } from './overlays'

/** One overlay: whether it is open, and how it is closed. */
function sheet() {
  const it = { open: true, closed: 0 }
  const off = overlays.show(() => {
    it.open = false
    it.closed++
  })

  return { ...it, off, state: it }
}

/** An Escape, as much of one as `escape` reads: whether it was answered, and
 *  whether it goes on to the listeners after this one. */
function keystroke() {
  const press = {
    defaultPrevented: false,
    stopped: false,
    preventDefault: () => (press.defaultPrevented = true),
    stopImmediatePropagation: () => (press.stopped = true),
  }

  return press
}

describe('escape', () => {
  test('closes nothing when nothing is open', () => {
    expect(overlays.escape()).toBe(false)
  })

  test('closes the one that is open', () => {
    const one = sheet()

    expect(overlays.escape()).toBe(true)
    expect(one.state.open).toBe(false)

    one.off()
  })

  test('closes the newest first, and leaves the one underneath standing', () => {
    const settings = sheet()
    const dropdown = sheet()

    expect(overlays.escape()).toBe(true)
    expect(dropdown.state.open).toBe(false)
    expect(settings.state.open).toBe(true)

    expect(overlays.escape()).toBe(true)
    expect(settings.state.open).toBe(false)
    expect(overlays.escape()).toBe(false)

    settings.off()
    dropdown.off()
  })

  test('closes each overlay once, however fast the key is pressed twice', () => {
    const settings = sheet()
    const dropdown = sheet()

    // Two presses in the same moment: closing is a change to a component's own
    // state, which reaches this list a moment later.
    overlays.escape()
    overlays.escape()

    expect(dropdown.state.closed).toBe(1)
    expect(settings.state.closed).toBe(1)

    settings.off()
    dropdown.off()
  })

  /** A press that closed an overlay is spent. Other things on the page read
   *  Escape off the same window - the find bar over a note being read, the one
   *  over a PDF - and a key that closed the palette must not also shut the bar
   *  underneath it. */
  test('takes the keystroke with it, so nothing else acts on the same press', () => {
    const one = sheet()
    const press = keystroke()

    expect(overlays.escape(press)).toBe(true)
    expect(press.defaultPrevented).toBe(true)
    expect(press.stopped).toBe(true)

    one.off()
  })

  test('leaves a press nothing was open for alone', () => {
    const press = keystroke()

    expect(overlays.escape(press)).toBe(false)
    expect(press.defaultPrevented).toBe(false)
    expect(press.stopped).toBe(false)
  })

  /** Four deep: a full-screen deck, a sheet, the settings and a dropdown inside
   *  them. One press closes one, newest first, and the fourth press has nothing
   *  left to close - the deck goes last, which is what puts the caret back on
   *  the slide somebody stopped at. */
  test('unwinds a deep stack one press at a time, newest first', () => {
    const closed: string[] = []
    const offs = ['deck', 'sheet', 'settings', 'dropdown'].map((name) =>
      overlays.show(() => closed.push(name)),
    )

    while (overlays.escape()) {
      // Each press closes exactly one, so the order is the whole answer.
    }

    expect(closed).toEqual(['dropdown', 'settings', 'sheet', 'deck'])
    for (const off of offs) off()
  })

  test('an overlay that closes itself is no longer on the stack', () => {
    const one = sheet()
    one.off()

    expect(overlays.depth).toBe(0)
    expect(overlays.escape()).toBe(false)
    expect(one.state.closed).toBe(0)
  })

  test('one taken off from under another leaves the order it was in', () => {
    const settings = sheet()
    const dropdown = sheet()

    // The pane behind the dropdown was closed by something other than Escape.
    settings.off()

    expect(overlays.escape()).toBe(true)
    expect(dropdown.state.open).toBe(false)
    expect(overlays.depth).toBe(0)

    dropdown.off()
  })
})
