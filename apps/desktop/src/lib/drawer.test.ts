import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

/** The sidebar a thumb pulls out. The arithmetic is in swipe.ts; what this
 *  covers is the part that needs a finger and a screen: which gestures the
 *  drawer takes, and which it has to keep its hands off.
 *
 *  Nothing here is a phone. The host, the panels inside it and the element
 *  under the finger are the few members the handlers actually read. */

/** How far the drawer can travel, which the host is measured for. */
const WIDTH = 280

/** How near the left edge a tablet's drag has to start; the tokens' value. */
const EDGE = 32

/** What the finger is on. Set per gesture; the drag reads it once, at the
 *  start, through `elementFromPoint`. */
let touched: Element | null = null

/** A box as the walk over it reads a box. */
function box(overflowX: string, scrollWidth: number, touchAction = 'auto'): Element {
  // Cast because only the members the walk looks at are worth writing.
  return {
    overflowX,
    scrollWidth,
    clientWidth: 320,
    touchAction,
    parentElement: null,
  } as unknown as Element
}

/** Plain writing: nothing under it goes anywhere sideways. */
const prose = box('visible', 320)
/** A wide table, which owns any sideways drag over it. */
const table = box('auto', 900)
/** A canvas, which has said it takes every touch on it for its own ink. */
const canvas = box('hidden', 320, 'none')

vi.stubGlobal('getComputedStyle', (node: { overflowX?: string; touchAction?: string }) => ({
  overflowX: node.overflowX ?? 'visible',
  touchAction: node.touchAction ?? 'auto',
  getPropertyValue: () => `${EDGE}px`,
}))
vi.stubGlobal('document', { elementFromPoint: () => touched, documentElement: {} })
vi.stubGlobal('window', { innerWidth: 1280 })

/** The element both layers live in, and the handlers it was given. */
function stage() {
  const listeners = new Map<string, (event: never) => void>()
  const element = {
    querySelector: () => ({ getBoundingClientRect: () => ({ width: WIDTH }) }),
    addEventListener: (kind: string, run: (event: never) => void) => listeners.set(kind, run),
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

/** A fresh drawer over a fresh workspace, since both remember the last
 *  gesture, on a device of the given kind. */
async function opened(device: 'phone' | 'tablet' = 'phone') {
  vi.resetModules()
  const workspace = {
    panel: null as string | null,
    showPanel(next: string) {
      this.panel = this.panel === next ? null : next
    },
  }
  vi.doMock('./workspace.svelte', () => ({ workspace }))
  vi.doMock('./viewport.svelte', () => ({ viewport: { device } }))

  const { drawer } = await import('./drawer.svelte')
  const host = stage()
  const stop = drawer.follow(host.element)

  /** One finger - or one pen - down, across and up, over whatever `on` is. */
  const swipe = (on: Element, from: number, to: number, pointer = 'touch', y = 400) => {
    touched = on
    let at = 0
    host.listeners.get('pointerdown')?.({ pointerType: pointer } as never)
    host.listeners.get('touchstart')?.(moment(from, y, (at += 16)) as never)
    for (let x = from; Math.abs(x - to) > 20; x += Math.sign(to - from) * 20) {
      host.listeners.get('touchmove')?.(moment(x, y, (at += 16)) as never)
    }
    return {
      /** How far the drawer has been pulled out, before the finger lifts. */
      pulled: drawer.at,
      lift: () => host.listeners.get('touchend')?.(moment(to, y, (at += 16)) as never),
    }
  }

  return { drawer, workspace, swipe, stop, host }
}

beforeAll(async () => {
  // Reading the store compiles its runes, which on a cold cache costs more than
  // a test is given.
  const first = await opened()
  first.stop()
})

afterEach(() => {
  vi.doUnmock('./workspace.svelte')
  vi.doUnmock('./viewport.svelte')
})

describe('the drag that opens the drawer', () => {
  test('a sideways pull over the writing opens it and follows the thumb', async () => {
    const { swipe, workspace, drawer } = await opened()

    const drag = swipe(prose, 30, 200)
    expect(workspace.panel).toBe('tree')
    expect(drag.pulled).toBeGreaterThan(0)
    // The layers are on the compositor while the finger is down, and off it
    // again the moment the finger lifts.
    expect(drawer.held).toBe(true)
    drag.lift()
    expect(drawer.held).toBe(false)
  })

  test('a scroll up the note is not a pull, however far it goes', async () => {
    const { drawer, workspace } = await opened()
    const host = stage()

    // Straight up the screen, which the drag gives up on at the first move.
    touched = prose
    drawer.follow(host.element)
    host.listeners.get('touchstart')?.(moment(200, 600, 16) as never)
    host.listeners.get('touchmove')?.(moment(202, 500, 32) as never)
    host.listeners.get('touchmove')?.(moment(204, 380, 48) as never)

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
    } as never)
    host.listeners.get('touchmove')?.(moment(200, 400, 32) as never)

    expect(drawer.at).toBe(null)
  })
})

describe('a pen is drawing, not swiping', () => {
  test('a stroke across the note leaves the drawer where it was', async () => {
    const { swipe, workspace, drawer } = await opened('tablet')

    expect(swipe(prose, 8, 400, 'pen').pulled).toBe(null)
    expect(workspace.panel).toBe(null)
    expect(drawer.held).toBe(false)
  })

  test('nor over the canvas, which is where the pen mostly is', async () => {
    const { swipe, workspace } = await opened('tablet')

    expect(swipe(canvas, 8, 400, 'pen').pulled).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('a finger after a pen is still a finger', async () => {
    const { swipe, workspace } = await opened('tablet')

    swipe(prose, 8, 400, 'pen')
    expect(workspace.panel).toBe(null)

    expect(swipe(prose, 8, 400).pulled).toBeGreaterThan(0)
    expect(workspace.panel).toBe('tree')
  })
})

describe('where a tablet lets the drag begin', () => {
  test('at the left edge, the way a tablet app has it', async () => {
    const { swipe, workspace } = await opened('tablet')

    expect(swipe(prose, EDGE - 8, 300).pulled).toBeGreaterThan(0)
    expect(workspace.panel).toBe('tree')
  })

  test('and nowhere else: a drag in the middle of the page belongs to the page', async () => {
    const { swipe, workspace } = await opened('tablet')

    expect(swipe(prose, 500, 900).pulled).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('a finger over the canvas belongs to the canvas wherever it starts', async () => {
    const { swipe, workspace } = await opened('tablet')

    expect(swipe(canvas, 4, 300).pulled).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('open, it closes from anywhere: the drawer is under the finger', async () => {
    const { swipe, workspace } = await opened('tablet')

    swipe(prose, 8, 300).lift()
    expect(workspace.panel).toBe('tree')

    const back = swipe(prose, 260, 20)
    expect(back.pulled).toBeLessThan(WIDTH)
    back.lift()
    expect(workspace.panel).toBe(null)
  })

  test('a phone opens from the middle, where an edge would be a thin target', async () => {
    const { swipe, workspace } = await opened('phone')

    expect(swipe(prose, 500, 900).pulled).toBeGreaterThan(0)
    expect(workspace.panel).toBe('tree')
  })
})
