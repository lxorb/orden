import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'

/** Every tab as a window on a canvas (issue #331), opened by Alt Alt, the top bar's button
 *  or the palette's row: one window per tab of every pane, the arrows walk them, Enter
 *  or a press opens one, Escape and the key again send them home. In the jsdom project
 *  because the windows are mounted; asked for less movement, so every window is where it
 *  goes at once and nothing waits on a frame. How it moves is overview/spring.ts's test. */

window.matchMedia = ((query: string) => ({
  matches: query.includes('reduce'),
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia
Element.prototype.scrollIntoView = () => undefined

const { default: Overview } = await import('../../src/lib/overview/Overview.svelte')
const { tabOverview } = await import('../../src/lib/surfaces.svelte')
const { appCommands } = await import('../../src/lib/commands')
const { overlays } = await import('../../src/lib/overlays')
const { runTap } = await import('../../src/lib/tapped')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')

let close: () => void

beforeEach(() => {
  workspace.panes.collapse()
  workspace.tabs = []
  for (const name of ['One', 'Two', 'Three']) workspace.openBlank(name, `# ${name}`)
  // A second pane, whose tab is a window too.
  workspace.split('row')
  const made = mount(Overview, { target: document.body })
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  tabOverview.open = false
  flushSync()
  close()
  vi.restoreAllMocks()
})

const windows = () => [...document.querySelectorAll<HTMLButtonElement>('.window')]
const layer = () => document.querySelector('.canvas')

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  document.activeElement?.dispatchEvent(event)
  flushSync()
  return event
}

async function opened() {
  appCommands()
    .find((one) => one.id === 'tab-overview')
    ?.run()
  flushSync()
  await tick()
}

test('the palette’s row shows one window per tab, the strip leaves them out, the keyboard on the one in front', async () => {
  await opened()
  expect(windows().map((one) => one.getAttribute('aria-label'))).toEqual([
    'One',
    'Two',
    'Three',
    'Three',
  ])
  expect(tabOverview.out).toHaveLength(4)
  expect(document.activeElement).toBe(document.querySelector('.window[aria-current="page"]'))
})

test('a press on a window opens its tab, and every window goes home', async () => {
  await opened()
  windows()[0]?.click()
  flushSync()
  await tick()
  expect(workspace.activeTabId).toBe(workspace.tabs[0]?.id)
  expect(tabOverview.open).toBe(false)
  expect(layer()).toBe(null)
  expect(tabOverview.out).toEqual([])
  expect(overlays.depth).toBe(0)
})

test('the arrows walk to another window, which opens as a press on it does', async () => {
  await opened()
  windows()[0]?.focus()
  press('ArrowRight')
  const walked = document.activeElement as HTMLButtonElement | null
  expect(walked).not.toBe(windows()[0])
  expect(windows()).toContain(walked)
  // Enter on a button is its click, in a browser; jsdom has no default actions.
  const id = workspace.tabs.find((one) => one.shown === walked?.getAttribute('aria-label'))?.id
  walked?.click()
  flushSync()
  expect(workspace.active?.shown).toBe(walked?.getAttribute('aria-label'))
  expect(id).toBeTruthy()
})

test('Escape sends them home and goes nowhere', async () => {
  await opened()
  const before = workspace.activeTabId
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  expect(tabOverview.open).toBe(false)
  expect(layer()).toBe(null)
  expect(workspace.activeTabId).toBe(before)
})

test('Alt tapped twice opens it, and again puts it away', async () => {
  const context = { palette: () => undefined, fullscreen: () => undefined }
  expect(runTap('Alt', context)).toBe(true)
  flushSync()
  await tick()
  expect(windows()).toHaveLength(4)

  expect(runTap('Alt', context)).toBe(true)
  flushSync()
  await tick()
  expect(layer()).toBe(null)
})

test('a web tab’s window shows its page as it was left, a tab nowhere in the file list is dashed', async () => {
  const page = workspace.openPage('https://example.com/') ?? ''
  pages.of(page).shot = 'data:image/png;base64,AA=='
  await opened()
  const web = windows().find((one) => one.querySelector('img'))
  expect(web?.querySelector('img')?.getAttribute('src')).toBe(pages.of(page).shot)
  // Every tab here is a draft or a page nobody kept.
  expect(windows().every((one) => one.classList.contains('unsaved'))).toBe(true)
})

test('nothing in it is chosen as text, and a drag is never the browser’s own', async () => {
  await opened()
  for (const at of [layer(), windows()[0], document.querySelector('.caption')]) {
    for (const kind of ['selectstart', 'dragstart']) {
      const event = new Event(kind, { bubbles: true, cancelable: true })
      at?.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  }
})

test('it comes back where the camera was left', async () => {
  await opened()
  const world = () => document.querySelector<HTMLElement>('.world')?.style.transform
  const canvas = layer()
  canvas?.dispatchEvent(
    new WheelEvent('wheel', { deltaX: 120, deltaY: 40, bubbles: true, cancelable: true }),
  )
  flushSync()
  const moved = world()
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  await opened()
  expect(world()).toBe(moved)
})

test('Tidy up puts every window back where its panes put it', async () => {
  const { places } = await import('../../src/lib/overview/places.svelte')
  const id = workspace.tabs[0]?.id ?? ''
  places.keepWindows({ [id]: { x: 4000, y: 4000, w: 300, h: 200 } }, workspace.tabs)
  await opened()
  expect(places.windows[id]).toEqual({ x: 4000, y: 4000, w: 300, h: 200 })
  document.querySelector<HTMLButtonElement>('.tidy')?.click()
  flushSync()
  await tick()
  expect(places.windows).toEqual({})
})

test('a window put by hand is found again by the next run, whose tabs have new ids', async () => {
  const { places } = await import('../../src/lib/overview/places.svelte')
  const [first] = workspace.tabs
  places.keepWindows({ [first?.id ?? '']: { x: 3000, y: 10, w: 300, h: 200 } }, workspace.tabs)
  // The next run: the same tabs, every id new.
  const again = workspace.tabs.map((one) => ({
    id: `${one.id}-again`,
    kind: one.kind,
    path: one.path,
    shown: one.shown,
  }))
  places.recall(again)
  expect(places.windows[`${first?.id}-again`]).toEqual({ x: 3000, y: 10, w: 300, h: 200 })
})

test('a window’s cross closes its tab the strip’s way, which asks where that asks, and the view stays', async () => {
  await opened()
  const closing = vi.spyOn(workspace, 'closeAsking')
  const [first] = windows()
  const id = workspace.tabs.find((one) => one.shown === first?.getAttribute('aria-label'))?.id
  const cross = first?.nextElementSibling as HTMLButtonElement | null
  expect(cross?.classList.contains('closer')).toBe(true)
  expect(cross?.getAttribute('aria-label')).toBe('Close')
  cross?.click()
  flushSync()
  await tick()
  expect(closing).toHaveBeenCalledWith(id)
  // The press was the cross's: the window was not opened and the view is still up.
  expect(tabOverview.open).toBe(true)
  expect(layer()).not.toBe(null)
})

test('each pane is its own window, moved where it is and never copied, and every tab is out of its strip', async () => {
  // Asked for less movement, every window is out at once. The panes, which their tabs in
  // front are the windows of.
  const panes = workspace.panes.all.map((one) => one.id)
  const shown = panes.map((id, index) => {
    const pane = document.createElement('div')
    pane.dataset.pane = id
    pane.getBoundingClientRect = () => new DOMRect(index * 600, 40, 600, 700)
    document.body.append(pane)
    return pane
  })
  onTestFinished(() => shown.forEach((one) => one.remove()))
  await opened()
  // The pane itself is drawn as its window - moved, made small, taking no press - and the
  // window over it draws nothing of it: no copy of the pane anywhere.
  for (const pane of shown) {
    expect(pane.style.transform).toMatch(/translate\(.*\) scale\(/)
    expect(pane.style.pointerEvents).toBe('none')
  }
  const fronts = new Set(workspace.panes.all.map((one) => one.activeTabId))
  for (const window of windows()) {
    const id = workspace.tabs.find((one) => one.shown === window.getAttribute('aria-label'))?.id
    if (id && fronts.has(id)) expect(window.querySelector('.face')).toBe(null)
  }
  expect(tabOverview.lifted).toEqual([])
  // And every tab is out of its strip, the ones in front too: the bar is the window's,
  // seen, and a strip that kept them would show each of them twice.
  expect([...tabOverview.out].sort()).toEqual(workspace.tabs.map((one) => one.id).sort())
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  // Home, each pane is drawn where it is laid out again, as it always is.
  for (const pane of shown) expect(pane.getAttribute('style') ?? '').toBe('')
  expect(tabOverview.out).toEqual([])
})

test('a pane holding a web page moves as its window, its picture in its hole and no copy of it', async () => {
  const page = workspace.openPage('https://example.com/') ?? ''
  pages.of(page).shot = 'data:image/png;base64,AA=='
  const shoot = vi.spyOn(pages, 'shoot')
  const paneId = workspace.tabs.find((one) => one.id === page)?.paneId ?? ''
  const pane = document.createElement('div')
  pane.dataset.pane = paneId
  pane.getBoundingClientRect = () => new DOMRect(0, 40, 600, 700)
  document.body.append(pane)
  onTestFinished(() => pane.remove())
  await opened()
  // A window drawn from the photograph alone was the page over its pane's bar as it left
  // and as it came home (#1136); the pane itself moves now, as a note's does.
  expect(pane.style.transform).toContain('scale(')
  expect(tabOverview.lifted).not.toContain(paneId)
  const window = windows().find(
    (one) =>
      one.getAttribute('aria-label') === workspace.tabs.find((tab) => tab.id === page)?.shown,
  )
  expect(window?.querySelector('.face-box > .face')).toBe(null)
  expect(shoot).toHaveBeenCalledWith(page)
})

test('the canvas is the window’s own ground, its sidebars sliding away, and the app blurred only when asked for', async () => {
  const { modes } = await import('../../src/lib/modes.svelte')
  await opened()
  // Nothing laid over the app: no ground of its own, the sidebars slid all the way out.
  expect(document.querySelector('.ground')).toBe(null)
  expect(document.documentElement.dataset.overview).toBe('slide')
  expect(document.documentElement.style.getPropertyValue('--overview-open')).toBe('1')
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  expect(document.documentElement.dataset.overview).toBe(undefined)
  expect(document.documentElement.style.getPropertyValue('--overview-open')).toBe('')
  modes.toggleOverviewBlur()
  try {
    await opened()
    expect(document.querySelector('.ground')?.classList.contains('is-blurred')).toBe(true)
    expect(document.documentElement.dataset.overview).toBe('blur')
  } finally {
    modes.toggleOverviewBlur()
  }
})

test('a web page steps behind its picture for as long as the overview is up, from its first frame', async () => {
  const { layersOver } = await import('../../src/lib/web-tab/covers')
  const hole = document.createElement('div')
  document.body.append(hole)
  onTestFinished(() => hole.remove())
  await opened()
  // The canvas itself is a clear scrim, there and seen as soon as it is: never hidden on
  // its first frames as the blurred ground is (covers.ts `seen`).
  const canvas = layer() as HTMLElement | null
  expect(canvas?.matches('.nib-scrim.is-clear')).toBe(true)
  expect(canvas?.style.visibility).toBe('')
  expect(layersOver(hole).some((one) => one.scrim && one.node === canvas)).toBe(true)
})

test('a window’s cross sits on its corner, red, and answers the pointer', async () => {
  await opened()
  const window = windows()[0]
  const cross = window?.nextElementSibling as HTMLElement | null
  // On the window's top right corner itself, its middle on it (the transform below).
  const [x, y] = (/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(window?.style.transform ?? '') ?? [])
    .slice(1)
    .map(Number)
  const width = parseFloat(window?.style.width ?? '0')
  expect(cross?.style.translate).toBe(`${String((x ?? 0) + width)}px ${String(y)}px`)
  // The app's quiet grey button, only its cross red, small, and under the pointer lit
  // and a little larger: its own rules, as the component declares them (jsdom lays
  // nothing out and hovers nothing).
  const { default: source } = await import('../../src/lib/overview/Overview.svelte?raw')
  /** The body of the rule whose selectors start `head`, up to its brace. */
  const rule = (head: string) => {
    const at = source.indexOf(`\n  ${head}`)
    return at < 0 ? '' : source.slice(source.indexOf('{', at), source.indexOf('}', at))
  }
  expect(rule('.closer {')).toContain('color: var(--danger)')
  expect(rule('.closer {')).toContain('background: var(--surface-2)')
  expect(rule('.closer {')).not.toMatch(/background:[^;]*--danger/)
  expect(rule('.closer {')).toContain('translate(-50%, -50%)')
  expect(rule('.closer {')).toMatch(/--closer-size: 2[0-4]px/)
  const hovered = [...source.matchAll(/\n {2}([^{}]*\.closer:hover[^{}]*)\{([^}]*)\}/g)].map(
    (one) => one[2] ?? '',
  )
  expect(
    hovered.some(
      (one) =>
        one.includes('--surface-hover') &&
        one.includes('scale(1.18)') &&
        !/background:[^;]*--danger/.test(one),
    ),
  ).toBe(true)
})

test('every window’s name, and the bubbles, are drawn under the panes and every window, so none lies on another window', async () => {
  // The room the panes are drawn in, which the layer under them goes first in.
  const room = document.createElement('div')
  room.dataset.panes = ''
  room.append(document.createElement('div'))
  document.body.append(room)
  onTestFinished(() => room.remove())
  await opened()
  const under = room.firstElementChild
  expect(under?.classList.contains('under')).toBe(true)
  expect(under?.querySelectorAll('.caption')).toHaveLength(windows().length)
  expect(under?.querySelector('.window')).toBe(null)
  expect(layer()?.querySelector('.caption')).toBe(null)
  // And it goes with the overview.
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  expect(room.querySelector('.under')).toBe(null)
})

test('every scroll zooms about the pointer, Ctrl or not, and none moves the canvas', async () => {
  await opened()
  const world = () => document.querySelector<HTMLElement>('.world')
  const read = () => {
    const transform = world()?.style.transform ?? ''
    const [x, y, zoom] = (
      /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(transform) ?? []
    )
      .slice(1)
      .map(Number)
    return { x: x ?? 0, y: y ?? 0, zoom: zoom ?? 1 }
  }
  const at = { clientX: 400, clientY: 300 }
  const pointUnder = () => {
    const now = read()
    return { x: (at.clientX - now.x) / now.zoom, y: (at.clientY - now.y) / now.zoom }
  }
  // Asked for less movement, a notch is where it goes at once.
  for (const [deltaY, ctrlKey] of [
    [-100, false],
    [-6, false],
    [-100, true],
    [-4, true],
  ] as const) {
    const before = read()
    const under = pointUnder()
    layer()?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        deltaX: 25,
        ctrlKey,
        ...at,
        bubbles: true,
        cancelable: true,
      }),
    )
    flushSync()
    const after = read()
    expect(after.zoom, `${String(deltaY)} ${String(ctrlKey)}`).toBeGreaterThan(before.zoom)
    // Zoomed about the pointer and nothing else: the point under it stays under it.
    expect(pointUnder().x).toBeCloseTo(under.x)
    expect(pointUnder().y).toBeCloseTo(under.y)
  }
})

test('a zoom only moves the camera: where the windows lie, and how big, is the same at every zoom', async () => {
  // Emil, round 4: scrolling changed the bubbles - the room kept under each window for
  // its name grew as the camera drew back, and the windows were laid out again.
  await opened()
  const laidOut = () =>
    windows().map((one) => [one.style.width, one.style.height, one.style.transform].join(' '))
  const before = laidOut()
  for (const deltaY of [400, 400, 400]) {
    layer()?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    )
    flushSync()
  }
  expect(document.querySelector<HTMLElement>('.world')?.style.transform).toMatch(/scale\(0\.[0-5]/)
  // Once the zoom has come to rest, and a while after.
  await new Promise((go) => setTimeout(go, 400))
  flushSync()
  expect(laidOut()).toEqual(before)
})

test('Ctrl+Click chooses windows, and again lets one go; a plain click opens its tab', async () => {
  await opened()
  const [first, second] = windows()
  const click = (one: HTMLElement | undefined, init: MouseEventInit = {}) => {
    one?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
    flushSync()
  }
  click(first, { ctrlKey: true })
  click(second, { metaKey: true })
  expect(windows().filter((one) => one.classList.contains('is-chosen'))).toEqual([first, second])
  expect(tabOverview.open).toBe(true)
  click(first, { ctrlKey: true })
  expect(windows().filter((one) => one.classList.contains('is-chosen'))).toEqual([second])
  click(first)
  expect(tabOverview.open).toBe(false)
  expect(workspace.active?.shown).toBe(first?.getAttribute('aria-label'))
})

test('the sides are not opened or shut while it is up, by their buttons, keys or menu', async () => {
  // Emil, round 4: the sidebar buttons did strange things in the overview.
  const panel = workspace.panel
  const right = workspace.rightShows
  await opened()
  workspace.toggleSidebar()
  workspace.toggleSidebar('right')
  expect(workspace.panel).toBe(panel)
  expect(workspace.rightShows).toBe(right)
  tabOverview.open = false
  flushSync()
  workspace.toggleSidebar()
  expect(workspace.panel).not.toBe(panel)
  workspace.toggleSidebar()
})
