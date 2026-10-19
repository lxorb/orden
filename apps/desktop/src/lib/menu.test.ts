import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The menu store itself: when it is open, and which press shuts it.
 *
 *  A press anywhere on the window shuts whatever menu is open - that is how a menu is
 *  dismissed by clicking past it - and the one press that must not shut it is the press
 *  that opened it. A menu whose rows have to be asked for opens a moment after that
 *  press, while it is still on its way to the window, so the two have to be told apart
 *  by when they happened. The terminal card's chevron is the one that asks: it opened
 *  the list of shells and lost it again in the same click (issue #244).
 *
 *  The store reads storage the moment it is made, so that is stood in for before it is
 *  imported, and `sharing.svelte.ts` wants an account a unit test has none of. Driven by
 *  hand: nothing here draws anything. */

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

vi.mock('./sharing.svelte', () => ({
  canShareItem: () => false,
  canWriteAt: () => true,
  shareThisFile: () => undefined,
}))

const { menu } = await import('./menu.svelte')

/** As much of a press as `show` reads, which is a point and the two calls that spend
 *  it: `MouseEvent` is the window's and this project is Node's. */
function press(x = 10, y = 20): MouseEvent {
  return {
    clientX: x,
    clientY: y,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as MouseEvent
}

beforeEach(() => {
  menu.hide()
})

// Which press shuts a menu - one past it, and never the one that opened it - is the
// overlay stack's, as it is for every popup; see `pressed` in overlays.test.ts.
describe('what opens a menu', () => {
  test('an empty list is no menu at all', () => {
    menu.show(press(), [])
    expect(menu.open).toBe(false)
  })
})
