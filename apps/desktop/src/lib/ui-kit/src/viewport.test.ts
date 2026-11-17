import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

const KEYS = 340

interface Kind {
  app?: boolean
  agent?: string
  mobile?: boolean | null
  finger?: boolean
}

const AGENTS = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  phone:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  tablet:
    'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  asked: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605',
} as const

function stubDocument(window: { layout: number }) {
  const attributes = new Set<string>()

  return {
    documentElement: {
      get clientHeight() {
        return window.layout
      },
      dataset: {} as Record<string, string>,
      attributes,
      toggleAttribute: (name: string, on: boolean) =>
        on ? attributes.add(name) : attributes.delete(name),
      style: { setProperty: () => undefined },
    },
  }
}

function stubWindow(width = 390, height = 844, finger = false) {
  const resized: (() => void)[] = []
  const turned: (() => void)[] = []

  const seen = {
    width,
    height,
    offsetTop: 0,
    scale: 1,
    addEventListener: (_kind: string, run: () => void) => void resized.push(run),
    removeEventListener: () => undefined,
  }

  return {
    innerWidth: width,
    innerHeight: height,
    layout: height,
    visualViewport: seen,
    matchMedia: (query: string) => ({
      matches: query.includes('pointer: coarse') ? finger : false,
      addEventListener: () => undefined,
    }),
    addEventListener: (_kind: string, run: () => void) => void turned.push(run),
    scrolled: null as [number, number] | null,
    scrollTo(x: number, y: number) {
      this.scrolled = [x, y]
    },
    keysOver(pixels: number) {
      seen.height = height - pixels
      for (const run of resized) run()
    },
    keysOverSliding(pixels: number, slid: number) {
      seen.height = height - pixels
      seen.offsetTop = slid
      for (const run of resized) run()
    },
    innerShrinks() {
      this.innerHeight = seen.height
      for (const run of resized) run()
    },
    keysBelow(pixels: number) {
      seen.height = height - pixels
      this.innerHeight = height - pixels
      this.layout = height - pixels
      for (const run of resized) run()
    },
    turned() {
      this.innerWidth = height
      this.innerHeight = width
      this.layout = width
      seen.width = height
      seen.height = width
      for (const run of [...turned, ...resized]) run()
    },
  }
}

async function started(kind: Kind = {}, width = 390, height = 844) {
  const window = stubWindow(width, height, kind.finger ?? false)
  const document = stubDocument(window)
  vi.resetModules()
  vi.doMock('../../platform/src/tauri', () => ({ isMobile: kind.app ?? false }))
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  vi.stubGlobal('navigator', {
    userAgent: kind.agent ?? AGENTS.desktop,
    ...(kind.mobile === undefined || kind.mobile === null
      ? {}
      : { userAgentData: { mobile: kind.mobile } }),
  })

  const { pageHeight, viewport } = await import('./viewport.svelte')
  viewport.start()

  return { pageHeight, viewport, window, root: document.documentElement }
}

async function machine(kind: Kind = {}) {
  const { deviceFor } = await import('./viewport.svelte')

  return (width: number, height: number) =>
    deviceFor(width, height, {
      native: kind.app ?? false,
      handheld: kind.mobile ?? null,
      agent: kind.agent ?? AGENTS.desktop,
      finger: kind.finger ?? false,
    })
}

beforeAll(async () => {
  await started()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('./tauri')
})

describe('the keyboard', () => {
  test('in a browser it covers the page, and the page says by how much', async () => {
    const { viewport, window } = await started()
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
    const { viewport, window } = await started({ app: true })

    window.keysBelow(KEYS)
    expect(viewport.keyboard).toBe(0)
    expect(viewport.height).toBe(844 - KEYS)
    expect(viewport.typing).toBe(true)

    window.keysBelow(0)
    expect(viewport.typing).toBe(false)
  })

  test('an iPhone sliding the page up to the caret is put back, and the keys measured whole', async () => {
    const { viewport, window } = await started({ app: true, finger: true })

    window.keysOverSliding(KEYS, KEYS)
    expect(window.scrolled).toEqual([0, 0])
    expect(viewport.keyboard).toBe(KEYS)
    expect(viewport.typing).toBe(true)
  })

  test('an iPhone saying its window shrank as the page scrolled still has its keys', async () => {
    const { viewport, window } = await started({ app: true, finger: true })

    window.keysOver(KEYS)
    window.innerShrinks()
    expect(viewport.keyboard).toBe(KEYS)
    expect(viewport.typing).toBe(true)
  })

  test('a browser window made shorter by hand is not a keyboard', async () => {
    const { viewport, window } = await started()

    window.keysBelow(KEYS)
    expect(viewport.typing).toBe(false)
  })

  test('a few pixels of browser chrome sliding away is not one either', async () => {
    const { viewport, window } = await started()

    window.keysOver(60)
    expect(viewport.typing).toBe(false)
  })

  test('turning the phone is a new window, not a keyboard', async () => {
    const { viewport, window } = await started({ app: true })

    window.turned()
    expect(viewport.typing).toBe(false)
    expect(viewport.height).toBe(390)
  })
})

describe('which device this is', () => {
  test('the app on a phone is a phone, either way up', async () => {
    const device = await machine({ app: true })

    expect(device(390, 844)).toBe('phone')
    expect(device(844, 390)).toBe('phone')
  })

  test('the app on a tablet is a tablet, not a phone with a big screen', async () => {
    const device = await machine({ app: true })

    expect(device(800, 1280)).toBe('tablet')
    expect(device(1280, 800)).toBe('tablet')
    expect(device(600, 960)).toBe('tablet')
  })

  test('a phone browser is a phone: it says so, and the glass says so', async () => {
    const phone = await machine({ agent: AGENTS.phone, mobile: true, finger: true })

    expect(phone(412, 915)).toBe('phone')
    expect(phone(915, 412)).toBe('phone')
  })

  test('a tablet browser is a tablet, though it calls itself no such thing', async () => {
    const tablet = await machine({ agent: AGENTS.tablet, mobile: false, finger: true })
    expect(tablet(800, 1280)).toBe('tablet')

    const ipad = await machine({ agent: AGENTS.ipad, finger: true })
    expect(ipad(1024, 768)).toBe('tablet')
  })

  test('a phone asked for the desktop site is a desktop, which is the point', async () => {
    const asked = await machine({ agent: AGENTS.asked, mobile: false, finger: true })

    expect(asked(980, 1743)).toBe('desktop')
    expect(asked(412, 915)).toBe('desktop')
  })

  test('and it is a desktop even if the hint beside the string says otherwise', async () => {
    const asked = await machine({ agent: AGENTS.asked, mobile: true, finger: true })

    expect(asked(980, 1743)).toBe('desktop')
  })

  test('a desktop window dragged narrow stays a desktop', async () => {
    const desktop = await machine()

    expect(desktop(420, 900)).toBe('desktop')
    expect(desktop(320, 700)).toBe('desktop')
    expect(desktop(1280, 800)).toBe('desktop')
  })

  test('a desktop with a touch screen is a desktop', async () => {
    expect((await machine({ finger: false }))(1280, 800)).toBe('desktop')
    expect((await machine({ finger: true }))(1280, 800)).toBe('desktop')
  })

  test('and a touch screen alone is not a handheld either', async () => {
    const spoofed = await machine({ agent: AGENTS.phone, mobile: true, finger: false })
    expect(spoofed(412, 915)).toBe('desktop')
  })
})

describe('what the document is told', () => {
  test('the app on a tablet: touch, and the drawer while it is upright', async () => {
    const upright = await started({ app: true }, 800, 1280)

    expect(upright.viewport.device).toBe('tablet')
    expect(upright.viewport.touch).toBe(true)
    expect(upright.viewport.narrow).toBe(false)
    expect(upright.root.dataset.device).toBe('tablet')
    expect(upright.viewport.drawer).toBe(true)
    expect(upright.root.attributes.has('data-drawer')).toBe(true)

    upright.window.turned()
    expect(upright.viewport.portrait).toBe(false)
    expect(upright.viewport.drawer).toBe(false)
    expect(upright.root.attributes.has('data-drawer')).toBe(false)
    expect(upright.root.attributes.has('data-touch')).toBe(true)
  })

  test('a desktop browser: no touch, and no drawer', async () => {
    const { viewport, root } = await started({}, 1280, 800)

    expect(viewport.device).toBe('desktop')
    expect(viewport.touch).toBe(false)
    expect(viewport.installed).toBe(false)
    expect(root.attributes.has('data-touch')).toBe(false)
  })

  test('the width, whichever device it is', async () => {
    const phone = await started({ app: true }, 390, 844)
    expect(phone.viewport.narrow).toBe(true)
    expect(phone.root.attributes.has('data-narrow')).toBe(true)

    phone.window.turned()
    expect(phone.viewport.device).toBe('phone')
    expect(phone.viewport.drawer).toBe(true)
    expect(phone.viewport.narrow).toBe(false)
    expect(phone.root.attributes.has('data-narrow')).toBe(false)

    const window = await started({}, 420, 900)
    expect(window.viewport.device).toBe('desktop')
    expect(window.viewport.narrow).toBe(true)
    expect(window.root.attributes.has('data-narrow')).toBe(true)
    expect(window.root.attributes.has('data-drawer')).toBe(false)
  })
})

describe('a page that fills the screen', () => {
  test('is the viewport, and gives the keyboard its share back', async () => {
    const { pageHeight, window } = await started({ app: true })
    expect(pageHeight()).toBe('844px')

    window.keysOver(KEYS)
    expect(pageHeight()).toBe(`${844 - KEYS}px`)
  })

  test('is the window everywhere else, which CSS can say on its own', async () => {
    const { pageHeight } = await started({}, 1280, 800)
    expect(pageHeight()).toBe(undefined)
  })
})
