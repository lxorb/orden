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
