import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'

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

test('a web tab’s window shows its page as it was left, and only a draft’s window is dashed', async () => {
  const page = workspace.openPage('https://example.com/') ?? ''
  pages.of(page).shot = 'data:image/png;base64,AA=='
  await opened()
  const web = windows().find((one) => one.querySelector('img'))
  expect(web?.querySelector('img')?.getAttribute('src')).toBe(pages.of(page).shot)
  expect(web?.classList.contains('unsaved')).toBe(false)
  const drafts = windows().filter((one) => one !== web)
  expect(drafts.length).toBeGreaterThan(0)
  expect(drafts.every((one) => one.classList.contains('unsaved'))).toBe(true)
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
  expect(tabOverview.open).toBe(true)
  expect(layer()).not.toBe(null)
})

test('each pane is its own window, moved where it is and never copied, and every tab is out of its strip', async () => {
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
  expect([...tabOverview.out].sort()).toEqual(workspace.tabs.map((one) => one.id).sort())
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  for (const pane of shown) expect(pane.getAttribute('style') ?? '').toBe('')
  expect(tabOverview.out).toEqual([])
})

test('a pane holding a web page moves as its window, its picture in its hole and no copy of it', async () => {
  const page = workspace.openPage('https://example.com/') ?? ''
  pages.of(page).shot = 'data:image/png;base64,AA=='
  const paneId = workspace.tabs.find((one) => one.id === page)?.paneId ?? ''
  const pane = document.createElement('div')
  pane.dataset.pane = paneId
  pane.getBoundingClientRect = () => new DOMRect(0, 40, 600, 700)
  document.body.append(pane)
  onTestFinished(() => pane.remove())
  await opened()
  expect(pane.style.transform).toContain('scale(')
  expect(tabOverview.lifted).not.toContain(paneId)
  const window = windows().find(
    (one) =>
      one.getAttribute('aria-label') === workspace.tabs.find((tab) => tab.id === page)?.shown,
  )
  expect(window?.querySelector('.face-box > .face')).toBe(null)
  expect(pages.still).toBe(true)
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  expect(pages.still).toBe(false)
})

test('the canvas is the window’s own ground, its sidebars sliding away, and the app blurred only when asked for', async () => {
  const { modes } = await import('../../src/lib/modes.svelte')
  const bar = document.createElement('header')
  bar.dataset.chrome = 'top'
  bar.innerHTML = '<button>Back</button>'
  const side = document.createElement('aside')
  side.dataset.chrome = 'start'
  document.body.append(bar, side)
  onTestFinished(() => {
    bar.remove()
    side.remove()
  })
  const button = bar.querySelector('button')
  await opened()
  expect(document.querySelector('.ground')).toBe(null)
  expect(document.documentElement.dataset.overview).toBe('slide')
  expect(side.style.getPropertyValue('--overview-slide')).toBe('1')
  expect(button?.style.getPropertyValue('--overview-open')).toBe('1')
  expect(document.documentElement.style.getPropertyValue('--overview-open')).toBe('')
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  expect(document.documentElement.dataset.overview).toBe(undefined)
  expect(side.style.getPropertyValue('--overview-slide')).toBe('')
  expect(button?.style.getPropertyValue('--overview-open')).toBe('')
  modes.toggleOverviewBlur()
  try {
    await opened()
    expect(document.querySelector('.ground')?.classList.contains('is-blurred')).toBe(true)
    expect(document.documentElement.dataset.overview).toBe('blur')
  } finally {
    modes.toggleOverviewBlur()
  }
})

test('every page stands still from before the first frame to after the last, and the canvas is no layer a page has to find', async () => {
  const { layersOver } = await import('../../src/lib/web-tab/covers')
  const hole = document.createElement('div')
  document.body.append(hole)
  onTestFinished(() => hole.remove())
  appCommands()
    .find((one) => one.id === 'tab-overview')
    ?.run()
  flushSync()
  expect(pages.still).toBe(true)
  await tick()
  expect(layersOver(hole).some((one) => layer()?.contains(one.node ?? null))).toBe(false)
  expect(layer()?.classList.contains('nib-scrim')).toBe(false)
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  expect(pages.still).toBe(false)
})

test('a window’s cross sits on its corner, red, and answers the pointer', async () => {
  await opened()
  const window = windows()[0]
  const cross = window?.nextElementSibling as HTMLElement | null
  const [x, y, zoom] = (
    /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)/.exec(window?.style.transform ?? '') ??
    []
  )
    .slice(1)
    .map(Number)
  const width = parseFloat(window?.style.width ?? '0') * (zoom ?? 1)
  const [cx, cy] = (cross?.style.translate ?? '').split(' ').map(parseFloat)
  expect(cx).toBeCloseTo((x ?? 0) + width, 3)
  expect(cy).toBeCloseTo(y ?? 0, 3)
  const { default: source } = await import('../../src/lib/overview/Overview.svelte?raw')
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
  await opened()
  const under = document.querySelector<HTMLElement>('.under')
  expect(under?.querySelectorAll('.caption')).toHaveLength(windows().length)
  expect(under?.querySelector('.window')).toBe(null)
  expect(layer()?.querySelector('.caption')).toBe(null)
  expect(under?.compareDocumentPosition(layer() as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  for (const one of windows()) expect(one.parentElement?.classList.contains('canvas')).toBe(true)
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  expect(document.querySelector('.under')).toBe(null)
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
    expect(pointUnder().x).toBeCloseTo(under.x)
    expect(pointUnder().y).toBeCloseTo(under.y)
  }
})

test('a zoom only moves the camera: where the windows lie, and how big, is the same at every zoom', async () => {
  await opened()
  const laidOut = () => {
    const [cx, cy, zoom] = (
      /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
        document.querySelector<HTMLElement>('.world')?.style.transform ?? '',
      ) ?? []
    )
      .slice(1)
      .map(Number)
    return windows().map((one) => {
      const [x, y] = (/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(one.style.transform) ?? [])
        .slice(1)
        .map(Number)
      const at = [((x ?? 0) - (cx ?? 0)) / (zoom ?? 1), ((y ?? 0) - (cy ?? 0)) / (zoom ?? 1)]
      return [one.style.width, one.style.height, ...at.map((v) => v.toFixed(2))].join(' ')
    })
  }
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
