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
