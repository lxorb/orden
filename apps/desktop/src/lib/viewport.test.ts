import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

/** The keyboard reaches the layout in two different shapes, and the store has to
 *  read both as the same thing. In a browser the page keeps its height and the
 *  keys cover the bottom of it, so the visual viewport is shorter than the
 *  window. In the phone app the window itself is made shorter, so the two agree
 *  and the only trace of the keyboard is the height that has gone. */

const KEYS = 340

/** A window the size of a phone, with the two heights a test can move apart. */
function phoneWindow() {
  const resized: (() => void)[] = []

  const seen = {
    width: 390,
    height: 844,
    offsetTop: 0,
    addEventListener: (_kind: string, run: () => void) => void resized.push(run),
    removeEventListener: () => undefined,
  }

  return {
    innerHeight: 844,
    visualViewport: seen,
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    /** What the browser does when the keys come up over the page. */
    keysOver(pixels: number) {
      seen.height = 844 - pixels
      for (const run of resized) run()
    },
    /** What the app does instead: the page ends where the keys begin. */
    keysBelow(pixels: number) {
      seen.height = 844 - pixels
      this.innerHeight = 844 - pixels
      for (const run of resized) run()
    },
    /** Turned on its side, which is a new window rather than a keyboard. */
    turned() {
      seen.width = 844
      seen.height = 390
      this.innerHeight = 390
      for (const run of resized) run()
    },
  }
}

/** A fresh store, because whether this is the phone app is decided once, when
 *  the module is first read. */
async function started(mobile: boolean) {
  const window = phoneWindow()
  vi.resetModules()
  vi.doMock('./tauri', () => ({ isMobile: mobile }))
  vi.stubGlobal('window', window)

  const { viewport } = await import('./viewport.svelte')
  viewport.start()

  return { viewport, window }
}

beforeAll(async () => {
  // Reading the store compiles its runes, and on a cold cache that costs more
  // than a test is given. A hook is allowed longer, so the first read is here.
  await started(false)
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('./tauri')
})

describe('the keyboard', () => {
  test('in a browser it covers the page, and the page says by how much', async () => {
    const { viewport, window } = await started(false)
    expect(viewport.typing).toBe(false)
    expect(viewport.keyboard).toBe(0)

    window.keysOver(KEYS)
    expect(viewport.keyboard).toBe(KEYS)
    expect(viewport.height).toBe(844 - KEYS)
    expect(viewport.typing).toBe(true)

    window.keysOver(0)
    expect(viewport.keyboard).toBe(0)
    expect(viewport.typing).toBe(false)
  })

  test('in the app it takes the height instead, and nothing is covered', async () => {
    const { viewport, window } = await started(true)

    window.keysBelow(KEYS)
    expect(viewport.keyboard).toBe(0)
    expect(viewport.height).toBe(844 - KEYS)
    expect(viewport.typing).toBe(true)

    window.keysBelow(0)
    expect(viewport.typing).toBe(false)
  })

  test('a browser window made shorter by hand is not a keyboard', async () => {
    const { viewport, window } = await started(false)

    window.keysBelow(KEYS)
    expect(viewport.typing).toBe(false)
  })

  test('a few pixels of browser chrome sliding away is not one either', async () => {
    const { viewport, window } = await started(false)

    window.keysOver(60)
    expect(viewport.typing).toBe(false)
  })

  test('turning the phone is a new window, not a keyboard', async () => {
    const { viewport, window } = await started(true)

    window.turned()
    expect(viewport.typing).toBe(false)
    expect(viewport.height).toBe(390)
  })
})

describe('the phone layout', () => {
  test('the app is a phone whatever the screen measures', async () => {
    const { viewport } = await started(true)
    expect(viewport.phone).toBe(true)
    expect(viewport.installed).toBe(true)
  })

  test('a browser window this wide is not', async () => {
    const { viewport } = await started(false)
    expect(viewport.phone).toBe(false)
    expect(viewport.installed).toBe(false)
  })
})
