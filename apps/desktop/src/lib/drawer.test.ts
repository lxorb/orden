import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

/** The sidebar a phone pulls out with a thumb. The arithmetic is in swipe.ts;
 *  what this covers is the part that needs a finger and a screen: which
 *  gestures the drawer takes, and which it has to keep its hands off.
 *
 *  Nothing here is a phone. The host, the panels inside it and the element
 *  under the finger are the few members the handlers actually read. */

/** How far the drawer can travel, which the host is measured for. */
const WIDTH = 280

/** What the finger is on. Set per gesture; the drag reads it once, at the
 *  start, through `elementFromPoint`. */
let touched: Element | null = null

/** A box as the walk over it reads a box. */
function box(overflowX: string, scrollWidth: number, clientWidth = 320): Element {
  // Cast because only the members the walk looks at are worth writing.
  return { overflowX, scrollWidth, clientWidth, parentElement: null } as unknown as Element
}

/** Plain writing: nothing under it goes anywhere sideways. */
const prose = box('visible', 320)
/** A wide table, which owns any sideways drag over it. */
const table = box('auto', 900)

vi.stubGlobal('getComputedStyle', (node: { overflowX: string }) => ({ overflowX: node.overflowX }))
vi.stubGlobal('document', { elementFromPoint: () => touched })

/** The element both layers live in, and the handlers it was given. */
function stage() {
  const listeners = new Map<string, (event: TouchEvent) => void>()
  const element = {
    querySelector: () => ({ getBoundingClientRect: () => ({ width: WIDTH }) }),
    addEventListener: (kind: string, run: (event: TouchEvent) => void) => listeners.set(kind, run),
    removeEventListener: (kind: string) => listeners.delete(kind),
  }

  return { element: element as unknown as HTMLElement, listeners }
}

function moment(x: number, y: number, at: number): TouchEvent {
  return {
    touches: [{ clientX: x, clientY: y }],
    timeStamp: at,
    preventDefault: () => undefined,
  } as unknown as TouchEvent
}

/** A fresh drawer over a fresh workspace, since both remember the last gesture. */
async function opened() {
  vi.resetModules()
  const workspace = {
    panel: null as string | null,
    showPanel(next: string) {
      this.panel = this.panel === next ? null : next
    },
  }
  vi.doMock('./workspace.svelte', () => ({ workspace }))

  const { drawer } = await import('./drawer.svelte')
  const host = stage()
  const stop = drawer.follow(host.element)

  /** One finger down, across and up, over whatever `on` is. */
  const swipe = (on: Element, from: number, to: number, y = 400) => {
    touched = on
    let at = 0
    host.listeners.get('touchstart')?.(moment(from, y, (at += 16)))
    for (let x = from; Math.abs(x - to) > 20; x += Math.sign(to - from) * 20) {
      host.listeners.get('touchmove')?.(moment(x, y, (at += 16)))
    }
    return {
      /** How far the drawer has been pulled out, before the finger lifts. */
      pulled: drawer.at,
      lift: () => host.listeners.get('touchend')?.(moment(to, y, (at += 16))),
    }
  }

  return { drawer, workspace, swipe, stop }
}

beforeAll(async () => {
  // Reading the store compiles its runes, which on a cold cache costs more than
  // a test is given.
  const first = await opened()
  first.stop()
})

afterEach(() => {
  vi.doUnmock('./workspace.svelte')
})

describe('the drag that opens the drawer', () => {
  test('a sideways pull over the writing opens it and follows the thumb', async () => {
    const { swipe, workspace } = await opened()

    const drag = swipe(prose, 30, 200)
    expect(workspace.panel).toBe('tree')
    expect(drag.pulled).toBeGreaterThan(0)
  })

  test('a scroll up the note is not a pull, however far it goes', async () => {
    const { drawer, workspace } = await opened()
    const host = stage()

    // Straight up the screen, which the drag gives up on at the first move.
    touched = prose
    drawer.follow(host.element)
    host.listeners.get('touchstart')?.(moment(200, 600, 16))
    host.listeners.get('touchmove')?.(moment(202, 500, 32))
    host.listeners.get('touchmove')?.(moment(204, 380, 48))

    expect(drawer.at).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('a table takes its own sideways drag, and the drawer stays put', async () => {
    const { swipe, workspace } = await opened()

    expect(swipe(table, 300, 60).pulled).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('it still stays put on the drag straight after one that moved it', async () => {
    const { swipe, workspace } = await opened()

    // The drawer is open, so the gesture that would close it is a leftward one:
    // the same direction as scrolling a table onwards. What the drawer knew
    // about the first drag must not reach the second.
    swipe(prose, 30, 200).lift()
    expect(workspace.panel).toBe('tree')

    expect(swipe(table, 300, 60).pulled).toBe(null)
    expect(workspace.panel).toBe('tree')
  })

  test('a second finger is a pinch, and the drawer lets go of the gesture', async () => {
    const { drawer } = await opened()
    const host = stage()
    drawer.follow(host.element)

    touched = prose
    host.listeners.get('touchstart')?.({
      touches: [
        { clientX: 30, clientY: 400 },
        { clientX: 200, clientY: 400 },
      ],
      timeStamp: 16,
      preventDefault: () => undefined,
    } as unknown as TouchEvent)
    host.listeners.get('touchmove')?.(moment(200, 400, 32))

    expect(drawer.at).toBe(null)
  })
})
