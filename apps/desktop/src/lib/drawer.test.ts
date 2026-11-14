import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

const WIDTH = 280

const EDGE = 32

let touched: Element | null = null

function box(overflowX: string, scrollWidth: number, touchAction = 'auto'): Element {
  return {
    overflowX,
    scrollWidth,
    clientWidth: 320,
    touchAction,
    parentElement: null,
    hasAttribute: () => false,
  } as unknown as Element
}

const prose = box('visible', 320)
const table = box('auto', 900)
const canvas = box('hidden', 320, 'none')

vi.stubGlobal('getComputedStyle', (node: { overflowX?: string; touchAction?: string }) => ({
  overflowX: node.overflowX ?? 'visible',
  touchAction: node.touchAction ?? 'auto',
  getPropertyValue: () => `${EDGE}px`,
}))
vi.stubGlobal('document', { elementFromPoint: () => touched, documentElement: {} })
vi.stubGlobal('window', { innerWidth: 1280 })

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

async function opened(device: 'phone' | 'tablet' = 'phone', right: string[] = []) {
  vi.resetModules()
  const workspace = {
    panel: null as string | null,
    rightPanel: null as string | null,
    right,
    reopens: 'tree',
    get nextRight(): string | null {
      return this.rightPanel ?? this.right[0] ?? null
    },
    openOn(side: 'left' | 'right'): string | null {
      return side === 'right' ? this.rightPanel : this.panel
    },
    showPanel(next: string) {
      if (this.right.includes(next)) this.rightPanel = next
      else this.panel = next
    },
    closePanel(side: 'left' | 'right' = 'left') {
      if (side === 'right') this.rightPanel = null
      else this.panel = null
    },
  }
  vi.doMock('./workspace.svelte', () => ({ workspace }))
  vi.doMock('./ui-kit/src/viewport.svelte', () => ({ viewport: { device } }))

  const { drawer, rightDrawer } = await import('./drawer.svelte')
  const { followDrawers } = await import('./drawer-follow')
  const host = stage()
  const stop = followDrawers(host.element)

  const swipe = (on: Element, from: number, to: number, pointer = 'touch', y = 400) => {
    touched = on
    let at = 0
    host.listeners.get('pointerdown')?.({ pointerType: pointer } as never)
    host.listeners.get('touchstart')?.(moment(from, y, (at += 16)) as never)
    for (let x = from; Math.abs(x - to) > 20; x += Math.sign(to - from) * 20) {
      host.listeners.get('touchmove')?.(moment(x, y, (at += 16)) as never)
    }
    return {
      pulled: drawer.at,
      pulledRight: rightDrawer.at,
      lift: () => host.listeners.get('touchend')?.(moment(to, y, (at += 16)) as never),
    }
  }

  return { drawer, followDrawers, rightDrawer, workspace, swipe, stop, host }
}

beforeAll(async () => {
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
    expect(drawer.held).toBe(true)
    drag.lift()
    expect(drawer.held).toBe(false)
  })

  test('a scroll up the note is not a pull, however far it goes', async () => {
    const { drawer, followDrawers, workspace } = await opened()
    const host = stage()

    touched = prose
    followDrawers(host.element)
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

    swipe(prose, 30, 200).lift()
    expect(workspace.panel).toBe('tree')

    expect(swipe(table, 300, 60).pulled).toBe(null)
    expect(workspace.panel).toBe('tree')
  })

  test('a second finger is a pinch, and the drawer lets go of the gesture', async () => {
    const { drawer, followDrawers } = await opened()
    const host = stage()
    followDrawers(host.element)

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

describe('the drag that opens the other side', () => {
  test('a pull the other way opens it and follows the thumb', async () => {
    const { swipe, workspace, rightDrawer } = await opened('phone', ['outline'])

    const drag = swipe(prose, 300, 60)
    expect(workspace.rightPanel).toBe('outline')
    expect(drag.pulledRight).toBeGreaterThan(0)
    expect(rightDrawer.held).toBe(true)
    drag.lift()
    expect(rightDrawer.held).toBe(false)
    expect(workspace.rightPanel).toBe('outline')
  })

  test('and leaves the left one where it was', async () => {
    const { swipe, workspace, drawer } = await opened('phone', ['outline'])

    swipe(prose, 300, 60).lift()
    expect(workspace.panel).toBe(null)
    expect(drawer.at).toBe(null)
  })

  test('a pull along the line still opens the file list', async () => {
    const { swipe, workspace } = await opened('phone', ['outline'])

    const drag = swipe(prose, 30, 260)
    expect(workspace.panel).toBe('tree')
    expect(workspace.rightPanel).toBe(null)
    expect(drag.pulled).toBeGreaterThan(0)
    expect(drag.pulledRight).toBe(null)
  })

  test('nothing happens where the right side holds nothing', async () => {
    const { swipe, workspace } = await opened('phone')

    const drag = swipe(prose, 300, 60)
    expect(drag.pulled).toBe(null)
    expect(drag.pulledRight).toBe(null)
    expect(workspace.rightPanel).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('open, a pull back the other way puts it away', async () => {
    const { swipe, workspace } = await opened('phone', ['outline'])

    swipe(prose, 300, 60).lift()
    expect(workspace.rightPanel).toBe('outline')

    const back = swipe(prose, 60, 300)
    expect(back.pulledRight).toBeLessThan(WIDTH)
    back.lift()
    expect(workspace.rightPanel).toBe(null)
  })

  test('settles over exactly the time the left one takes', async () => {
    const left = await opened('phone', ['outline'])
    left.swipe(prose, 30, 270).lift()
    expect(left.drawer.settle).toBeGreaterThan(0)
    expect(left.drawer.at).toBe(null)

    const right = await opened('phone', ['outline'])
    right.swipe(prose, 300, 60).lift()
    expect(right.rightDrawer.at).toBe(null)
    expect(right.rightDrawer.settle).toBe(left.drawer.settle)
  })

  test('a tablet opens it from its own edge and nowhere else', async () => {
    const near = await opened('tablet', ['outline'])
    expect(near.swipe(prose, 1276, 1000).pulledRight).toBeGreaterThan(0)
    expect(near.workspace.rightPanel).toBe('outline')

    const middle = await opened('tablet', ['outline'])
    expect(middle.swipe(prose, 640, 300).pulledRight).toBe(null)
    expect(middle.workspace.rightPanel).toBe(null)
  })

  test('the side that loses the gesture is not left promoted', async () => {
    const { swipe, drawer, rightDrawer } = await opened('phone', ['outline'])

    const drag = swipe(prose, 300, 60)
    expect(rightDrawer.held).toBe(true)
    expect(drawer.held).toBe(false)
    drag.lift()
  })

  test('a pen is drawing on that edge too', async () => {
    const { swipe, workspace } = await opened('tablet', ['outline'])

    expect(swipe(prose, 1276, 1000, 'pen').pulledRight).toBe(null)
    expect(workspace.rightPanel).toBe(null)
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

describe('the drawer on a phone', () => {
  test('opens on the tab last shown, the way back does', async () => {
    const { drawer, workspace } = await opened('phone')
    Object.assign(workspace, { reopens: 'tasks' })

    drawer.open()
    expect(workspace.panel).toBe('tasks')
  })
})
