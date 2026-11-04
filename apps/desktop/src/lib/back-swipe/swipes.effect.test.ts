import { describe, expect, test, vi } from 'vitest'

/** The arrow is glued to the fingers (#1050): drawn in the turn each step is heard in,
 *  from the very first step, with nothing measured on the way and nothing easing it after
 *  them. In the jsdom project, because the room it comes in over is the DOM's. Where it
 *  is for each step is gesture.test.ts, and that nothing eases it there is
 *  test/effects/with-the-fingers.effect.test.ts. */

vi.mock('../tauri', () => ({ isDesktop: false, isMobile: false }))
vi.mock('../web-tab/pages.svelte', () => ({
  pages: { of: () => ({ back: true, forward: false }) },
}))
vi.mock('../workspace.svelte', () => ({
  workspace: { tabs: [], goBack: () => undefined, goForward: () => undefined },
}))

const { heard } = await import('./swipes')
const { swiping } = await import('./shown.svelte')
type Tab = import('../workspace.svelte').Tab

const pane = document.createElement('div')
pane.dataset.pane = 'p'
document.body.append(pane)
let measured = 0
pane.getBoundingClientRect = () => {
  measured++
  return DOMRect.fromRect({ x: 0, y: 40, width: 800, height: 560 })
}

const tab = { id: 't', kind: 'note', paneId: 'p', canGoBack: true, canGoForward: false } as Tab
const NONE = { left: false, right: false }
const step = (dx: number, at: number) =>
  heard({ tab, source: 'touch', dx, dy: 0, at, scrolls: NONE })

describe('the arrow', () => {
  test('is out at the first step, where the fingers are, in the same turn', () => {
    step(-2, 1)
    expect(swiping.tab).toBe('t')
    expect(swiping.travel).toBe(2)
    for (let at = 2; at < 40; at++) {
      step(-3, at * 8)
      expect(swiping.travel).toBe(2 + 3 * (at - 1))
    }
  })

  test('measures the room it comes in over once, not at every step', () => {
    expect(measured).toBe(1)
  })
})
