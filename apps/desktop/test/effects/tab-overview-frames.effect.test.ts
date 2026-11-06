import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The tab overview's frames, moving (issue #331). Emil, on Windows: a short spike in the
 *  middle of the Alt Alt animation. A window's picture filled in half-way through the way
 *  in, and every frame had the whole app work out its style again, under a value set
 *  on the document that every element inherits. Here the frames are run by hand. */

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia
Element.prototype.scrollIntoView = () => undefined

let drawn: (() => void)[] = []
vi.mock('../../src/lib/reading/render', () => ({
  readingHtml: () =>
    new Promise<string>((done) => drawn.push(() => done('<p>Some words of it.</p>'))),
  unreadableHtml: (text: string) => text,
}))

const { default: Overview } = await import('../../src/lib/overview/Overview.svelte')
const { tabOverview } = await import('../../src/lib/surfaces.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { faces } = await import('../../src/lib/overview/faces.svelte')

let now = 0
let waiting = new Map<number, FrameRequestCallback>()
let next = 1

/** Runs the frame `ms` after the one before. */
function frame(ms = 1000 / 60) {
  now += ms
  const due = waiting
  waiting = new Map()
  for (const run of due.values()) run(now)
  flushSync()
}

let close: () => void
const app: HTMLElement[] = []

beforeEach(() => {
  drawn = []
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((run) => {
    waiting.set(next, run)
    return next++
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void waiting.delete(id))
  workspace.panes.collapse()
  workspace.tabs = []
  for (const name of ['One', 'Two', 'Three']) workspace.openBlank(name, `# ${name}`)
  // The app round the panes: a bar with its buttons, a sidebar, and a pane with a lot in it.
  const bar = document.createElement('header')
  bar.dataset.chrome = 'top'
  bar.innerHTML = '<button>Back</button><button data-overview-keeps>Search</button>'
  const side = document.createElement('aside')
  side.dataset.chrome = 'start'
  side.innerHTML = '<ul>' + '<li><span>A file</span></li>'.repeat(40) + '</ul>'
  const pane = document.createElement('div')
  pane.dataset.pane = workspace.panes.all[0]?.id ?? ''
  pane.innerHTML =
    '<div class="head"></div><div>' + '<p><span>Words</span></p>'.repeat(40) + '</div>'
  pane.getBoundingClientRect = () => new DOMRect(0, 40, 900, 700)
  app.push(bar, side, pane)
  document.body.append(bar, side, pane)
  const made = mount(Overview, { target: document.body })
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  tabOverview.open = false
  flushSync()
  for (let i = 0; i < 120 && waiting.size; i++) frame()
  close()
  for (const one of app.splice(0)) one.remove()
  vi.restoreAllMocks()
})

async function drawnNow() {
  await faces.read()
  for (const done of drawn.splice(0)) done()
  await Promise.resolve()
  await Promise.resolve()
  flushSync()
}

test('the windows set off only once what each of them shows is drawn', async () => {
  tabOverview.open = true
  flushSync()
  expect(drawn.length).toBeGreaterThan(0)
  for (let i = 0; i < 5; i++) frame()
  // Not begun: the strip keeps its tabs, and the app is what is on screen.
  expect(tabOverview.out).toEqual([])
  await drawnNow()
  frame()
  expect(tabOverview.out.length).toBeGreaterThan(0)
})

test('a picture that takes too long to draw does not keep the windows waiting', () => {
  tabOverview.open = true
  flushSync()
  for (let i = 0; i < 20; i++) frame()
  expect(tabOverview.out.length).toBeGreaterThan(0)
})

test('the first frame that moves moves by one frame, however long the frame before it took', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  frame()
  frame(400)
  const open = Number(
    document.querySelector<HTMLElement>('.top')?.style.getPropertyValue('--overview-open'),
  )
  expect(open).toBeGreaterThan(0)
  expect(open).toBeLessThan(0.3)
})

/** Custom properties that are registered as not inherited (Overview.svelte's `@property`):
 *  a change to one restyles only the element it is set on. */
const OWN = new Set(['--overview-slide', '--overview-lift'])

test('no frame sets a value that the panes, the sidebars or the windows’ pictures inherit', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  const written = new Map<Element, Set<string>>()
  for (let i = 0; i < 12; i++) {
    frame()
    for (const one of document.querySelectorAll<HTMLElement | SVGElement>('*')) {
      const style = one.style
      for (let k = 0; k < style.length; k++) {
        const name = style.item(k)
        if (!name.startsWith('--') || OWN.has(name)) continue
        written.set(
          one,
          (written.get(one) ?? new Set()).add(`${name}=${style.getPropertyValue(name)}`),
        )
      }
    }
  }
  const changing = [...written].filter(([, values]) => values.size > 1).map(([one]) => one)
  expect(changing.length).toBeGreaterThan(0)
  for (const one of changing) {
    expect(one.querySelectorAll('*').length).toBeLessThan(40)
    expect(one.querySelector('[data-pane], .face, [data-chrome]')).toBe(null)
  }
})

/** The tab worked in: its pane, which is its window, and how it is stacked. */
function front() {
  const pane = document.querySelector<HTMLElement>(`[data-pane="${workspace.panes.all[0]?.id}"]`)
  return pane?.style.zIndex ?? ''
}

test('the tab worked in is over every other window on every frame of the way out and home', async () => {
  // Emil: the other windows flew over the one worked in as it shrank.
  tabOverview.open = true
  flushSync()
  await drawnNow()
  const out: string[] = []
  for (let i = 0; i < 40 && waiting.size; i++) {
    frame()
    if (tabOverview.out.length) out.push(front())
  }
  expect(out.length).toBeGreaterThan(5)
  // Over the canvas the other windows are on, until every window is where it goes.
  const landed = out.indexOf('var(--z-raised)')
  expect(landed).toBeGreaterThan(5)
  expect(out.slice(0, landed).every((one) => one === 'var(--z-drawer)')).toBe(true)
  // At rest it is among the others again, under a window dragged over it.
  for (let i = 0; i < 200; i++) frame()
  expect(front()).toBe('var(--z-raised)')
  tabOverview.open = false
  flushSync()
  const home: string[] = []
  for (let i = 0; i < 200 && tabOverview.out.length; i++) {
    frame()
    if (tabOverview.out.length) home.push(front())
  }
  expect(home.length).toBeGreaterThan(5)
  expect(home.every((one) => one === 'var(--z-drawer)')).toBe(true)
  // The tabs riding on their windows are over it still.
  tabOverview.open = true
  flushSync()
  frame()
  frame()
  const riding = document.querySelector('.riding')
  expect(riding?.closest('.canvas')).toBe(null)
})

test('a picture that comes in while the windows fly is drawn once they are there, its mark till then', async () => {
  tabOverview.open = true
  flushSync()
  await faces.read()
  // Too long: the windows set off without it.
  for (let i = 0; i < 20; i++) frame()
  expect(tabOverview.out.length).toBeGreaterThan(0)
  const faceOf = () => document.querySelector('.window .face')
  expect(faceOf()?.querySelector('.mark')).not.toBe(null)
  for (const done of drawn.splice(0)) done()
  await Promise.resolve()
  await Promise.resolve()
  flushSync()
  frame()
  // Not half-way: a window's picture filled in mid-flight was a long frame.
  expect(faceOf()?.querySelector('.read')).toBe(null)
  expect(faceOf()?.querySelector('.mark')).not.toBe(null)
  for (let i = 0; i < 200 && waiting.size; i++) frame()
  expect(faceOf()?.querySelector('.read')?.textContent).toContain('Some words of it.')
})

test('a window drawn before is drawn at once the next time, never waited on', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  for (let i = 0; i < 200 && waiting.size; i++) frame()
  tabOverview.open = false
  flushSync()
  for (let i = 0; i < 200 && waiting.size; i++) frame()
  tabOverview.open = true
  flushSync()
  expect(drawn).toEqual([])
  expect(document.querySelector('.window .face .read')?.textContent).toContain('Some words of it.')
  await Promise.resolve()
  await Promise.resolve()
  frame()
  expect(tabOverview.out.length).toBeGreaterThan(0)
})

test('a zoom makes no layer of its own and lets none go: every frame of it is drawn as it is shown', async () => {
  // Emil: zooming in or out made the bubbles and the windows flash.
  tabOverview.open = true
  flushSync()
  await drawnNow()
  for (let i = 0; i < 200; i++) frame()
  // Landed, and a moment after: drawn at the size it is shown, as it rests.
  for (let i = 0; i < 8; i++) {
    await new Promise((go) => setTimeout(go, 60))
    frame()
  }
  const canvas = document.querySelector<HTMLElement>('.canvas')
  expect(canvas?.classList.contains('is-moving')).toBe(false)
  const world = () => document.querySelector<HTMLElement>('.canvas .world')?.style.transform
  const pane = document.querySelector<HTMLElement>(`[data-pane="${workspace.panes.all[0]?.id}"]`)
  const before = world()
  const layered: string[] = []
  for (let i = 0; i < 60; i++) {
    if (i % 6 === 0)
      canvas?.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: i < 30 ? -100 : 100,
          clientX: 400,
          clientY: 300,
          bubbles: true,
          cancelable: true,
        }),
      )
    frame()
    if (canvas?.classList.contains('is-moving')) layered.push(`frame ${i}: the canvas`)
    if (pane?.style.willChange === 'transform') layered.push(`frame ${i}: the pane`)
  }
  expect(world()).not.toBe(before)
  expect(layered).toEqual([])
})
