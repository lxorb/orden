import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import type { Cut } from '../../src/lib/web-tab/covers'

const asked: { command: string; args: Record<string, unknown> }[] = []

let holding: Promise<void> | null = null

let refuses: string | null = null

let cuts: boolean | 'under' = false

let answersLooks: number | null = null

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    asked.push({ command, args })
    if (command === refuses) return Promise.reject(new Error(`${command} was refused`))
    if (command === 'web_open' && holding) return holding
    if (command === 'web_look' && answersLooks !== null && answersLooks-- <= 0)
      return new Promise(() => undefined)
    if (command === 'web_place') return Promise.resolve(cuts)
    if (command === 'web_open' && cuts === 'under') return Promise.resolve(cuts)
    return Promise.resolve(undefined)
  },
}))

vi.mock('../../src/lib/own-window', () => ({
  hearHere: () => Promise.resolve(() => undefined),
}))

class NoLayout {
  static readonly all: NoLayout[] = []
  readonly watched = new Set<Element>()

  constructor(readonly heard: ResizeObserverCallback) {
    NoLayout.all.push(this)
  }

  observe(node: Element) {
    this.watched.add(node)
  }

  unobserve(node: Element) {
    this.watched.delete(node)
  }

  disconnect() {
    this.watched.clear()
  }
}

function resized(node: Element) {
  for (const one of NoLayout.all) {
    if (one.watched.has(node)) one.heard([], one)
  }
}

globalThis.ResizeObserver = NoLayout

Element.prototype.getBoundingClientRect = function box(this: Element): DOMRect {
  const gone = { x: 0, y: 0, width: 0, height: 0 }
  if (!this.isConnected) {
    return {
      ...gone,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => gone,
    }
  }

  const given = this.getAttribute('data-box')
  if (given !== null) {
    const rect = JSON.parse(given) as { x: number; y: number; width: number; height: number }
    return {
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    }
  }

  const placed = this.classList.contains('card')
    ? /translate:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(this.getAttribute('style') ?? '')
    : null
  if (placed) {
    const rect = { x: Number(placed[1]), y: Number(placed[2]), width: 256, height: 216 }
    return {
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    }
  }

  const hole = this.classList.contains('hole')
  const rect = { x: 0, y: hole ? 40 : 0, width: 800, height: hole ? 560 : 600 }
  return {
    ...rect,
    top: rect.y,
    left: rect.x,
    right: 800,
    bottom: 600,
    toJSON: () => rect,
  }
}

Element.prototype.getAnimations = () => []

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    set onfinish(done: (() => void) | null) {
      queueMicrotask(() => done?.())
    },
  }) as unknown as Animation

Object.defineProperty(globalThis, 'CSS', { value: { escape: (text: string) => text } })

let over: Element | null = null

document.elementFromPoint = () => over ?? document.querySelector('.hole')

const { overlays } = await import('../../src/lib/overlays')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const { startup } = await import('../../src/lib/startup.svelte')
const { hovering } = await import('../../src/lib/tab-strip/hover-card.svelte')
const WebTab = (await import('../../src/lib/web-tab/WebTab.svelte')).default

await Promise.all([
  import('../../src/lib/web-tab/visited'),
  import('../../src/lib/web-tab/web-data.svelte'),
  import('../../src/lib/web-tab/merged'),
  import('../../src/lib/web-tab/keys'),
  import('../../src/lib/web-tab/downloads.svelte'),
])

let target: HTMLElement

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Date',
    ],
  })
  asked.length = 0
  over = null
  holding = null
  refuses = null
  cuts = false
  answersLooks = null
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  hovering.hush()
  for (const pane of document.querySelectorAll('body > [data-pane]')) pane.remove()
  target.remove()
  vi.useRealTimers()
})

async function frames(): Promise<void> {
  await vi.advanceTimersByTimeAsync(300)
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await vi.advanceTimersByTimeAsync(0)
}

async function launched(): Promise<void> {
  startup.reset()
  const shown = startup.shown()
  await frames()
  await shown
}

test('switching away from a web tab keeps the page and switching back does not build one', async () => {
  await launched()

  const tab = workspace.tabs.find((one) => one.kind === 'web') ?? null
  workspace.openWebsite()
  const made = workspace.tabs.at(-1)
  expect(made?.kind).toBe('web')
  if (!made || tab) return

  pages.of(made.id).url = 'https://example.com/a'

  const first = mount(WebTab, { target, props: { tab: made, focused: true } })
  flushSync()
  await frames()

  await vi.waitFor(() => expect(pages.of(made.id).live).toBe(true), { timeout: 10_000 })
  expect(asked.map((one) => one.command)).toContain('web_open')

  asked.length = 0
  void unmount(first)
  flushSync()
  await frames()

  expect(asked.map((one) => one.command)).not.toContain('web_close')
  expect(pages.of(made.id).live).toBe(true)

  asked.length = 0
  const second = mount(WebTab, { target, props: { tab: made, focused: true } })
  flushSync()
  await frames()

  expect(asked.map((one) => one.command)).not.toContain('web_open')
  expect(asked.map((one) => one.command)).toContain('web_place')

  void unmount(second)
})

function layer(kind: string, box = { x: 100, y: 100, width: 240, height: 200 }): HTMLElement {
  const made = document.createElement('div')
  made.className = kind
  made.setAttribute('data-box', JSON.stringify(box))
  document.body.append(made)
  return made
}

test('the page is hidden while a layer of the app is over it, and comes back when it goes', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/over'

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).live).toBe(true)

  asked.length = 0
  const menu = layer('orden-layer')
  const off = overlays.show(() => undefined)
  await frames()

  const hidden = asked.filter((one) => one.command === 'web_place').at(-1)
  expect(hidden?.args.visible).toBe(false)
  const said = asked.map((one) => one.command)
  expect(said).toContain('web_shot')
  expect(said.indexOf('web_shot')).toBeLessThan(
    asked.findIndex((one) => one.command === 'web_place' && one.args.visible === false),
  )

  asked.length = 0
  off()
  menu.remove()
  await frames()

  const shown = asked.filter((one) => one.command === 'web_place').at(-1)
  expect(shown?.args.visible).toBe(true)

  void unmount(app)
})

test('a layer that is not over the page leaves it alone', async () => {
  const { app } = await opened('https://example.com/beside')

  asked.length = 0
  const card = layer('orden-bubble', { x: 820, y: 10, width: 200, height: 120 })
  const off = overlays.show(() => undefined)
  await frames()

  expect(asked.filter((one) => one.command === 'web_place' && one.args.visible === false)).toEqual(
    [],
  )
  expect(asked.map((one) => one.command)).not.toContain('web_shot')

  off()
  card.remove()
  void unmount(app)
})

test('a menu over the page is cut out of it, and the page stays', async () => {
  cuts = true
  const { app } = await opened('https://example.com/cut')

  asked.length = 0
  const menu = layer('orden-layer', { x: 100, y: 140, width: 240, height: 200 })
  const off = overlays.show(() => undefined)
  await frames()

  const placed = asked.filter((one) => one.command === 'web_place')
  expect(placed.every((one) => one.args.visible === true)).toBe(true)
  expect(placed.at(-1)?.args.cut).toEqual({
    all: false,
    hollows: [{ x: 100, y: 100, width: 240, height: 200, radius: 0 }],
  })

  asked.length = 0
  off()
  menu.remove()
  await frames()

  const back = asked.filter((one) => one.command === 'web_place').at(-1)
  expect(back?.args).toMatchObject({ visible: true, cut: null })

  void unmount(app)
})

async function hoverOver(tab: import('../../src/lib/workspace.svelte').Tab) {
  const pane = document.createElement('div')
  pane.setAttribute('data-pane', tab.paneId)
  pane.setAttribute('data-box', JSON.stringify({ x: 0, y: 0, width: 800, height: 600 }))
  document.body.append(pane)
  hovering.enter({ tab, box: { left: 100, right: 300, bottom: 38 }, focused: true })
  await frames()
  return () => hovering.hush()
}

test('a tab’s hover card over the page is cut out of it, and the page never blanks', async () => {
  cuts = true
  const { tab, app } = await opened('https://example.com/hovered')
  pages.of(tab.id).shot = null

  asked.length = 0
  const done = await hoverOver(tab)
  expect(document.querySelector('.card')).not.toBeNull()

  const placed = asked.filter((one) => one.command === 'web_place')
  expect(placed.length).toBeGreaterThan(0)
  expect(placed.every((one) => one.args.visible === true)).toBe(true)
  expect(placed.some((one) => (one.args.cut as { all: boolean } | null)?.all === true)).toBe(false)
  expect(placed.at(-1)?.args.cut).toMatchObject({ all: false })

  asked.length = 0
  done()
  await frames()
  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args).toMatchObject({
    visible: true,
    cut: null,
  })
  void unmount(app)
})

test('a hover card sliding on to the next tab takes its cut with it', async () => {
  cuts = true
  const { tab, app } = await opened('https://example.com/slid')
  const hollow = () =>
    (
      asked.filter((one) => one.command === 'web_place').at(-1)?.args.cut as {
        hollows: { x: number; y: number }[]
      } | null
    )?.hollows[0]

  const done = await hoverOver(tab)
  expect(hollow()).toMatchObject({ x: 100 })

  hovering.enter({ tab, box: { left: 420, right: 620, bottom: 38 }, focused: true })
  await frames()
  expect(hovering.card?.sliding).toBe(true)
  expect(hollow()).toMatchObject({ x: 420 })

  done()
  await frames()
  void unmount(app)
})

test('a layer that grows while it is open is cut out of the page at its new size', async () => {
  cuts = true
  const { app } = await opened('https://example.com/grown')
  const hollow = () =>
    (
      asked.filter((one) => one.command === 'web_place').at(-1)?.args.cut as {
        hollows: { height: number }[]
      } | null
    )?.hollows[0]

  const suggest = layer('orden-layer', { x: 100, y: 60, width: 400, height: 40 })
  const off = overlays.show(() => undefined)
  await frames()
  expect(hollow()).toMatchObject({ height: 40 })

  suggest.setAttribute('data-box', JSON.stringify({ x: 100, y: 60, width: 400, height: 240 }))
  resized(suggest)
  await frames()
  expect(hollow()).toMatchObject({ height: 240 })

  off()
  suggest.remove()
  await frames()
  void unmount(app)
})

test('a hover card never hides a page there is no picture of', async () => {
  const { tab, app } = await opened('https://example.com/unpictured')
  pages.of(tab.id).shot = null

  asked.length = 0
  const done = await hoverOver(tab)

  expect(asked.map((one) => one.command)).toContain('web_shot')
  expect(asked.filter((one) => one.command === 'web_place' && one.args.visible === false)).toEqual(
    [],
  )
  expect(hovering.card).toBeNull()

  done()
  await frames()
  void unmount(app)
})

test('a sheet over the page covers all of it at once, picture or none', async () => {
  cuts = true
  const { tab, app } = await opened('https://example.com/sheet')
  pages.of(tab.id).shot = null

  asked.length = 0
  const scrim = layer('orden-scrim', { x: 0, y: 0, width: 800, height: 600 })
  const sheet = layer('orden-screen', { x: 200, y: 100, width: 400, height: 300 })
  await settle()

  const placed = asked.filter((one) => one.command === 'web_place')
  expect(placed.length).toBeGreaterThan(0)
  expect(placed.every((one) => one.args.visible === true)).toBe(true)
  expect(placed.every((one) => (one.args.cut as { all: boolean } | null)?.all === true)).toBe(true)
  expect(asked.map((one) => one.command)).toContain('web_shot')

  scrim.remove()
  sheet.remove()
  await frames()
  void unmount(app)
})

describe('a layer is answered in the frame it is first drawn in, however it came', () => {
  interface Kind {
    name: string
    all: boolean
    ready: () => HTMLElement | null
    show: (ready: HTMLElement | null) => HTMLElement
    take: (shown: HTMLElement) => void
  }
  const box = { x: 100, y: 140, width: 240, height: 200 }
  const whole = { x: 0, y: 0, width: 800, height: 600 }
  const kinds: Kind[] = [
    {
      name: 'put in, in a shape of the theme',
      all: false,
      ready: () => null,
      show: () => layer('orden-layer', box),
      take: (shown) => shown.remove(),
    },
    {
      name: 'put in, marked',
      all: false,
      ready: () => null,
      show: () => {
        const made = layer('ghost', box)
        made.dataset.covers = ''
        return made
      },
      take: (shown) => shown.remove(),
    },
    {
      name: 'a clear scrim put in, as a menu’s and the overview’s canvas are',
      all: true,
      ready: () => null,
      show: () => layer('orden-scrim is-clear', whole),
      take: (shown) => shown.remove(),
    },
    {
      name: 'shown and hidden in place, as the bar over a filling tab is',
      all: false,
      ready: () => {
        const made = layer('bar', box)
        made.dataset.covers = ''
        made.hidden = true
        return made
      },
      show: (ready) => {
        if (!ready) throw new Error('nothing made ready')
        ready.hidden = false
        return ready
      },
      take: (shown) => {
        shown.hidden = true
      },
    },
    {
      name: 'shown and hidden by its style, as the overview’s ground is',
      all: true,
      ready: () => {
        const made = layer('orden-scrim', whole)
        made.style.visibility = 'hidden'
        return made
      },
      show: (ready) => {
        if (!ready) throw new Error('nothing made ready')
        ready.style.visibility = ''
        return ready
      },
      take: (shown) => {
        shown.style.visibility = 'hidden'
      },
    },
  ]

  const visible = Object.getOwnPropertyDescriptor(Element.prototype, 'checkVisibility')
  beforeEach(() => {
    Element.prototype.checkVisibility = function seen(this: Element) {
      const one = this as HTMLElement
      return !one.hidden && one.style.visibility !== 'hidden'
    }
  })
  afterEach(() => {
    if (visible) Object.defineProperty(Element.prototype, 'checkVisibility', visible)
    else delete (Element.prototype as Partial<Element>).checkVisibility
    for (const one of document.querySelectorAll('body > [data-box]')) one.remove()
  })

  const cut = () =>
    asked.filter((one) => one.command === 'web_place').at(-1)?.args.cut as Cut | null | undefined

  for (const kind of kinds) {
    test(kind.name, async () => {
      cuts = true
      const { tab, app } = await opened('https://example.com/kinds')
      pages.of(tab.id).shot = null
      const ready = kind.ready()
      await frames()

      asked.length = 0
      const shown = kind.show(ready)
      await settle()
      expect(cut()?.all).toBe(kind.all)
      if (!kind.all) expect(cut()?.hollows).toHaveLength(1)

      asked.length = 0
      kind.take(shown)
      await settle()
      expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args).toMatchObject({
        visible: true,
        cut: null,
      })

      await frames()
      void unmount(app)
    })
  }
})

test('the page is hidden while a drag is over the panes, and comes back when it ends', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/carried'

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).shown).toBe(true)

  asked.length = 0
  workspace.panes.dragging = { tabId: tab.id }
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)
  expect(asked.map((one) => one.command)).toContain('web_shot')

  asked.length = 0
  workspace.panes.dropped()
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(true)

  void unmount(app)
})

test('a pane that goes away puts its page out of sight', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/away'

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).live).toBe(true)
  expect(pages.of(tab.id).shown).toBe(true)

  asked.length = 0
  void unmount(app)
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)
  expect(pages.of(tab.id).shown).toBe(false)
})

test('a page that arrives after its pane has gone is never shown', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/late'

  let land: () => void = () => undefined
  holding = new Promise<void>((go) => {
    land = go
  })

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(asked.map((one) => one.command)).toContain('web_open')

  asked.length = 0
  void unmount(app)
  flushSync()
  await frames()

  land()
  holding = null
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)
  expect(pages.of(tab.id).shown).toBe(false)
})

test('a web tab that mounts under a layer on its way out still asks for its page', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/under'

  const leaving = document.createElement('div')
  document.body.append(leaving)
  over = leaving

  asked.length = 0
  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_open')).toHaveLength(1)
  expect(pages.of(tab.id).live).toBe(true)
  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)

  asked.length = 0
  over = null
  leaving.remove()
  await frames()

  expect(asked.filter((one) => one.command === 'web_open')).toHaveLength(0)
  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(true)

  void unmount(app)
})

async function opened(url: string) {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no web tab was opened')

  pages.of(tab.id).url = url

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).live).toBe(true)

  return { tab, app }
}

test('a refused address is not a page that has gone', async () => {
  const { tab, app } = await opened('https://example.com/refused')

  refuses = 'web_navigate'
  await pages.go(tab.id, 'https://example.com/elsewhere')
  refuses = null

  expect(pages.of(tab.id).live).toBe(true)

  refuses = 'web_step'
  await pages.step(tab.id, 'back')
  refuses = null
  expect(pages.of(tab.id).live).toBe(true)

  void unmount(app)
})

test('a page the window has given up on is still put out of sight', async () => {
  const { tab, app } = await opened('https://example.com/given-up')

  refuses = 'web_place'
  await pages.place(tab.id, { x: 0, y: 40, width: 800, height: 560 }, true)
  refuses = null
  expect(pages.of(tab.id).live).toBe(false)

  asked.length = 0
  void unmount(app)
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)
  expect(pages.of(tab.id).shown).toBe(false)
})

test('a build the crate refuses leaves no page behind it', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/refused-build'

  refuses = 'web_open'
  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  refuses = null

  expect(pages.of(tab.id).live).toBe(false)
  expect(pages.of(tab.id).openable).toBe(false)
  const closed = asked.filter((one) => one.command === 'web_close').at(-1)
  expect(closed?.args.keep).toBe(false)

  void unmount(app)
})

test('the still picture goes with the pane it was taken for', async () => {
  const { tab, app } = await opened('https://example.com/still')

  const shot = 'data:image/png;base64,iVBORw0KGgo='
  pages.of(tab.id).shot = shot
  flushSync()

  const hole = target.querySelector('.hole')
  expect(hole?.getAttribute('style')).toContain(shot)

  void unmount(app)
  flushSync()
  await frames()

  expect(document.querySelector('.hole')).toBe(null)
  expect(document.body.innerHTML).not.toContain(shot)
})

test('a picture of the page goes when the page is shown at another size', async () => {
  const { tab, app } = await opened('https://example.com/resized')
  const shot = 'data:image/png;base64,iVBORw0KGgo='
  const pane = pages.of(tab.id).pane
  if (!pane) throw new Error('the page was never placed')

  pages.of(tab.id).shot = shot
  await pages.place(tab.id, pane, true)
  expect(pages.of(tab.id).shot).toBe(shot)

  await pages.place(tab.id, { ...pane, height: pane.height - 78 }, true)
  expect(pages.of(tab.id).shot).toBeNull()

  void unmount(app)
})

describe('a page held still while its hole moves, and let go', () => {
  for (const cutting of [true, false, 'under'] as const) {
    test(cutting === 'under' ? 'drawn under the app' : cutting ? 'cut' : 'hidden', async () => {
      cuts = cutting
      const { tab, app } = await opened(`https://example.com/still-${String(cutting)}`)
      const page = pages.of(tab.id)
      page.shot = 'data:image/png;base64,iVBORw0KGgo='
      page.shotAt = Date.now()
      await settle()
      await frames()
      const hole = document.querySelector('.hole')
      if (!hole) throw new Error('no hole')
      onTestFinished(() => {
        hole.removeAttribute('data-box')
        void unmount(app)
      })
      const shown = asked.filter((one) => one.command === 'web_place').at(-1)?.args.pane

      asked.length = 0
      await pages.holdStill()
      await settle()
      const held = asked.filter((one) => one.command === 'web_place')
      expect(held.at(-1)?.args).toMatchObject(
        cutting === 'under' ? { visible: true, cut: { all: true } } : { visible: false },
      )
      expect(hole.classList.contains('still')).toBe(true)
      expect(hole.classList.contains('under')).toBe(false)

      asked.length = 0
      for (const [step, scale] of [0.9, 0.7, 0.5].entries()) {
        hole.setAttribute(
          'data-box',
          JSON.stringify({
            x: 30 * (step + 1),
            y: 40 + 20 * (step + 1),
            width: 800 * scale,
            height: 560 * scale,
          }),
        )
        await settle()
        await frames()
      }
      expect(asked.filter((one) => one.command === 'web_place')).toEqual([])

      hole.removeAttribute('data-box')
      await pages.letGo()
      await settle()
      await frames()
      expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args).toMatchObject({
        visible: true,
        cut: null,
        pane: shown,
      })
      expect(page.heldAt).toBe(null)
      expect(hole.classList.contains('under')).toBe(cutting === 'under')
    })
  }
})

test('a hole with no room puts its page out of sight, and the room back brings it back', async () => {
  const { tab, app } = await opened('https://example.com/no-room')
  const hole = target.querySelector('.hole')
  if (!hole) throw new Error('no hole')

  asked.length = 0
  hole.setAttribute('data-box', JSON.stringify({ x: 0, y: 40, width: 800, height: 0 }))
  resized(hole)
  await frames()

  const hidden = asked.filter((one) => one.command === 'web_place')
  expect(hidden.at(-1)?.args.visible).toBe(false)
  expect(pages.of(tab.id).onScreen).toBe(true)

  asked.length = 0
  hole.setAttribute('data-box', JSON.stringify({ x: 0, y: 40, width: 800, height: 560 }))
  resized(hole)
  await frames()

  const shown = asked.filter((one) => one.command === 'web_place')
  expect(shown.at(-1)?.args.visible).toBe(true)
  expect(shown.at(-1)?.args.pane).toEqual({ x: 0, y: 40, width: 800, height: 560 })

  void unmount(app)
})

test('a screen of another scale places the page again', async () => {
  const { app } = await opened('https://example.com/scale')
  const scale = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')

  asked.length = 0
  window.dispatchEvent(new Event('resize'))
  await frames()
  expect(asked.filter((one) => one.command === 'web_place')).toHaveLength(0)

  Object.defineProperty(window, 'devicePixelRatio', { value: 1.5, configurable: true })
  try {
    window.dispatchEvent(new Event('resize'))
    await frames()
    expect(asked.filter((one) => one.command === 'web_place')).toHaveLength(1)
  } finally {
    if (scale) Object.defineProperty(window, 'devicePixelRatio', scale)
    else Reflect.deleteProperty(window, 'devicePixelRatio')
  }

  void unmount(app)
})

test('a tab turned Separate is built again once, in its own store, and stays', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return
  pages.of(tab.id).url = 'https://example.com/apart'

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).live).toBe(true)

  asked.length = 0
  let built: () => void = () => undefined
  holding = new Promise<void>((go) => (built = go))
  answersLooks = 1

  const own = '3f9a0c17e2b4d685'
  tab.apart = own
  flushSync()
  const fromMenu = pages.rehouse(tab.id, own, 'kept apart')
  await vi.advanceTimersByTimeAsync(1000)
  built()
  holding = null
  await frames()
  await fromMenu
  await frames()

  const said = asked.map((one) => one.command)
  expect(said.filter((one) => one === 'web_open')).toHaveLength(1)
  expect(said.lastIndexOf('web_close')).toBeLessThan(said.lastIndexOf('web_open'))
  expect(asked.filter((one) => one.command === 'web_open').at(-1)?.args).toMatchObject({
    profile: { store: `note_${own}` },
  })
  expect(pages.of(tab.id).live).toBe(true)

  void unmount(app)
  pages.forget(tab.id)
})

describe('a page drawn under the app', () => {
  test('is never hidden or photographed for a layer, which only takes its input', async () => {
    cuts = 'under'
    const { app } = await opened('https://example.com/under')

    asked.length = 0
    document.querySelector('.hole')?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    const menu = layer('orden-layer', { x: 100, y: 140, width: 240, height: 200 })
    const off = overlays.show(() => undefined)
    await frames()

    const placed = asked.filter((one) => one.command === 'web_place')
    expect(placed.length).toBeGreaterThan(0)
    expect(placed.every((one) => one.args.visible === true)).toBe(true)
    expect(placed.at(-1)?.args).toMatchObject({
      cut: { all: false, hollows: [{ x: 100, y: 100, width: 240, height: 200, radius: 0 }] },
      opacity: 1,
    })
    expect(asked.map((one) => one.command)).not.toContain('web_shot')

    const scrim = layer('orden-scrim', { x: 0, y: 0, width: 800, height: 600 })
    await frames()
    expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args).toMatchObject({
      visible: true,
      cut: { all: true },
    })

    off()
    menu.remove()
    scrim.remove()
    void unmount(app)
  })

  test('shows through a hole in the grounds, which closes as its tab goes', async () => {
    cuts = 'under'
    const { app } = await opened('https://example.com/ground')

    expect(document.querySelector('.hole')?.classList.contains('under')).toBe(true)
    expect(document.body.hasAttribute('data-underlay')).toBe(true)
    expect(document.documentElement.hasAttribute('data-underlay')).toBe(true)
    expect(document.body.style.getPropertyValue('--underlay-clip')).toMatch(/^path\(evenodd, /)

    void unmount(app)
    flushSync()
    await frames()

    expect(document.body.hasAttribute('data-underlay')).toBe(false)
    expect(document.documentElement.hasAttribute('data-underlay')).toBe(false)
    expect(document.body.style.getPropertyValue('--underlay-clip')).toBe('')
  })
})
