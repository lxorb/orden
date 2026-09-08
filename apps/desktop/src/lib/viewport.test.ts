import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

/** Two things the store answers, and one it publishes.
 *
 *  The keyboard reaches the layout in two different shapes, and the store has to
 *  read both as the same thing. In a browser the page keeps its height and the
 *  keys cover the bottom of it, so the visual viewport is shorter than the
 *  window. In the phone app the window itself is made shorter, so the two agree
 *  and the only trace of the keyboard is the height that has gone.
 *
 *  The device class is the other: which of phone, tablet and desktop this
 *  window is, said once here and written on the document so no stylesheet can
 *  come to a different conclusion about the same screen. */

const KEYS = 340

/** The document as the store writes to it: the attributes it publishes, and
 *  the inline properties the insets would go into. */
function stubDocument() {
  const attributes = new Set<string>()

  return {
    documentElement: {
      dataset: {} as Record<string, string>,
      attributes,
      toggleAttribute: (name: string, on: boolean) =>
        on ? attributes.add(name) : attributes.delete(name),
      style: { setProperty: () => undefined },
    },
  }
}

/** A window of a given size, with the two heights a test can move apart. */
function stubWindow(width = 390, height = 844) {
  const resized: (() => void)[] = []
  const turned: (() => void)[] = []

  const seen = {
    width,
    height,
    offsetTop: 0,
    addEventListener: (_kind: string, run: () => void) => void resized.push(run),
    removeEventListener: () => undefined,
  }

  return {
    innerWidth: width,
    innerHeight: height,
    visualViewport: seen,
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    addEventListener: (_kind: string, run: () => void) => void turned.push(run),
    /** What the browser does when the keys come up over the page. */
    keysOver(pixels: number) {
      seen.height = height - pixels
      for (const run of resized) run()
    },
    /** What the app does instead: the page ends where the keys begin. */
    keysBelow(pixels: number) {
      seen.height = height - pixels
      this.innerHeight = height - pixels
      for (const run of resized) run()
    },
    /** Turned on its side, which is a new window rather than a keyboard. */
    turned() {
      this.innerWidth = height
      this.innerHeight = width
      seen.width = height
      seen.height = width
      for (const run of [...turned, ...resized]) run()
    },
  }
}

/** A fresh store, because whether this is the phone app is decided once, when
 *  the module is first read. */
async function started(mobile: boolean, width = 390, height = 844) {
  const window = stubWindow(width, height)
  const document = stubDocument()
  vi.resetModules()
  vi.doMock('./tauri', () => ({ isMobile: mobile }))
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)

  const { pageHeight, viewport } = await import('./viewport.svelte')
  viewport.start()

  return { pageHeight, viewport, window, root: document.documentElement }
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

describe('which device this is', () => {
  test('a narrow window is a phone, whatever is running it', async () => {
    const { deviceFor } = await import('./viewport.svelte')

    expect(deviceFor(390, 844, true)).toBe('phone')
    expect(deviceFor(390, 844, false)).toBe('phone')
    expect(deviceFor(720, 900, false)).toBe('phone')
  })

  test('a wide one is a tablet in the app and a desktop in a browser', async () => {
    const { deviceFor } = await import('./viewport.svelte')

    expect(deviceFor(1280, 800, true)).toBe('tablet')
    expect(deviceFor(1280, 800, false)).toBe('desktop')
    expect(deviceFor(800, 1280, true)).toBe('tablet')
  })

  test('a phone on its side is still a phone, and a short browser window is not', async () => {
    const { deviceFor } = await import('./viewport.svelte')

    expect(deviceFor(844, 390, true)).toBe('phone')
    // The same shape in a browser is somebody with a short window open.
    expect(deviceFor(844, 390, false)).toBe('desktop')
  })

  test('the app on a tablet is a tablet, not a phone with a big screen', async () => {
    const { viewport, root } = await started(true, 1280, 800)

    expect(viewport.device).toBe('tablet')
    expect(viewport.touch).toBe(true)
    expect(viewport.narrow).toBe(false)
    expect(root.dataset.device).toBe('tablet')
  })

  test('a browser window this wide is a desktop, which is what the web app was', async () => {
    const { viewport, root } = await started(false, 1280, 800)

    expect(viewport.device).toBe('desktop')
    expect(viewport.touch).toBe(false)
    expect(viewport.installed).toBe(false)
    expect(root.attributes.has('data-touch')).toBe(false)
  })

  test('a tablet held upright keeps the drawer; on its side it docks', async () => {
    const upright = await started(true, 800, 1280)
    expect(upright.viewport.drawer).toBe(true)
    expect(upright.root.attributes.has('data-drawer')).toBe(true)

    upright.window.turned()
    expect(upright.viewport.portrait).toBe(false)
    expect(upright.viewport.drawer).toBe(false)
    expect(upright.root.attributes.has('data-drawer')).toBe(false)
    expect(upright.root.attributes.has('data-touch')).toBe(true)
  })

  test('a phone is a drawer either way up, and a narrow one says so', async () => {
    const { viewport, window, root } = await started(true, 390, 844)

    expect(viewport.drawer).toBe(true)
    expect(viewport.narrow).toBe(true)
    expect(root.attributes.has('data-narrow')).toBe(true)

    window.turned()
    expect(viewport.device).toBe('phone')
    expect(viewport.drawer).toBe(true)
    // 844 wide is a phone on its side: past the narrow mark, still one column.
    expect(viewport.narrow).toBe(false)
    expect(root.attributes.has('data-narrow')).toBe(false)
  })
})

/** A page that fills the screen - the settings are one - is as tall as what is
 *  on screen, which on a touch device is not the window. */
describe('a page that fills the screen', () => {
  test('is the viewport, and gives the keyboard its share back', async () => {
    const { pageHeight, window } = await started(true)
    expect(pageHeight()).toBe('844px')

    window.keysOver(KEYS)
    expect(pageHeight()).toBe(`${844 - KEYS}px`)
  })

  test('is the window everywhere else, which CSS can say on its own', async () => {
    const { pageHeight } = await started(false, 1280, 800)
    expect(pageHeight()).toBe(undefined)
  })
})
