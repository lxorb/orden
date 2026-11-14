import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia
Element.prototype.scrollIntoView = () => undefined

let drawn: (() => void)[] = []
vi.mock('../../src/lib/reading/src/api', () => ({
  readingHtml: () =>
    new Promise<string>((done) => drawn.push(() => done('<p>Some words of it.</p>'))),
  unreadableHtml: (text: string) => text,
}))

const { default: Overview } = await import('../../src/lib/overview/src/Overview.svelte')
const { tabOverview } = await import('../../src/lib/surfaces.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { faces } = await import('../../src/lib/overview/src/faces.svelte')

let now = 0
let waiting = new Map<number, FrameRequestCallback>()
let next = 1

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

const OWN = new Set(['--overview-slide', '--overview-lift', '--overview-bar'])

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

function front() {
  const pane = document.querySelector<HTMLElement>(`[data-pane="${workspace.panes.all[0]?.id}"]`)
  return pane?.style.zIndex ?? ''
}

function others() {
  const active = workspace.tabs.find((one) => one.id === workspace.activeTabId)?.shown
  return [...document.querySelectorAll<HTMLElement>('.window')]
    .filter((one) => one.getAttribute('aria-label') !== active)
    .map((one) => (one.classList.contains('is-front') ? 'in front' : 'behind'))
}

test('the tab worked in is over every other window on every frame, and nothing is stacked anew as they land', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  const seen = new Set<string>()
  let frames = 0
  for (let i = 0; i < 400 && waiting.size; i++) {
    frame()
    if (!tabOverview.out.length) continue
    frames++
    seen.add(`${front()} over ${[...new Set(others())].join(',')}`)
  }
  tabOverview.open = false
  flushSync()
  for (let i = 0; i < 400 && tabOverview.out.length; i++) {
    frame()
    if (tabOverview.out.length) seen.add(`${front()} over ${[...new Set(others())].join(',')}`)
  }
  expect(frames).toBeGreaterThan(5)
  expect([...seen]).toEqual(['var(--z-float) over behind'])
  tabOverview.open = true
  flushSync()
  frame()
  frame()
  for (const one of document.querySelectorAll('.window, .rider, .closer'))
    expect(one.parentElement?.classList.contains('canvas')).toBe(true)
})

test('a picture that comes in while the windows fly is drawn once they are there, its mark till then', async () => {
  tabOverview.open = true
  flushSync()
  await faces.read()
  for (let i = 0; i < 20; i++) frame()
  expect(tabOverview.out.length).toBeGreaterThan(0)
  const faceOf = () => document.querySelector('.window .face')
  expect(faceOf()?.querySelector('.mark')).not.toBe(null)
  for (const done of drawn.splice(0)) done()
  await Promise.resolve()
  await Promise.resolve()
  flushSync()
  frame()
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

function layered(): string[] {
  return [...document.querySelectorAll<HTMLElement>('*')]
    .filter((one) => one.style.willChange !== '' || one.classList.contains('is-moving'))
    .map((one) => one.className || one.tagName)
}

test('no frame of the way out, a zoom or the way home makes a layer of its own or lets one go', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  const asked: string[] = []
  for (let i = 0; i < 200; i++) {
    frame()
    asked.push(...layered())
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((go) => setTimeout(go, 60))
    frame()
    asked.push(...layered())
  }
  const canvas = document.querySelector<HTMLElement>('.canvas')
  const windowAt = () => document.querySelector<HTMLElement>('.window')?.style.transform
  const before = windowAt()
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
    asked.push(...layered())
  }
  expect(windowAt()).not.toBe(before)
  tabOverview.open = false
  flushSync()
  for (let i = 0; i < 200 && waiting.size; i++) {
    frame()
    asked.push(...layered())
  }
  expect(asked).toEqual([])
})

const TOKENS = readFileSync(resolve('../../packages/themes/src/tokens.css'), 'utf8')
const SOURCE = await import('../../src/lib/overview/src/Overview.svelte?raw')

function rung(value: string): number {
  const named = /var\((--z-[a-z]+)\)/.exec(value)?.[1] ?? ''
  const at = Number(new RegExp(`${named}:\\s*(-?\\d+);`).exec(TOKENS)?.[1] ?? NaN)
  return value.includes('- 1') ? at - 1 : at
}

test('the one bar is over every window on every frame, and a window under it shows through it whole', async () => {
  const bar = app[0]!
  bar.getBoundingClientRect = () => new DOMRect(0, 0, 900, 40)
  Element.prototype.setPointerCapture = () => undefined
  const style = SOURCE.default.slice(SOURCE.default.indexOf('<style>'))
  const zOf = (selector: string) =>
    [...style.matchAll(/\n {2}([^{}]+)\{([^}]*)\}/g)]
      .filter(([, head]) => head?.split(',').some((one) => one.trim() === selector))
      .map(([, , body]) => /z-index:\s*([^;]+);/.exec(body ?? '')?.[1] ?? '')
      .filter(Boolean)
  const barZ = rung(zOf(":global(html[data-overview] header[data-chrome='top'])")[0] ?? '')
  expect(barZ).toBe(rung('var(--z-bar)'))
  for (const one of [
    '.window',
    '.window.is-front',
    '.window.is-held',
    '.closer.is-front',
    '.closer.is-held',
    '.rider.is-front',
  ])
    for (const value of zOf(one)) expect(rung(value), one).toBeLessThan(barZ)

  tabOverview.open = true
  flushSync()
  await drawnNow()
  const pane = document.querySelector<HTMLElement>(`[data-pane="${workspace.panes.all[0]?.id}"]`)
  for (let i = 0; i < 200 && waiting.size; i++) {
    frame()
    if (pane?.style.zIndex) expect(rung(pane.style.zIndex)).toBeLessThan(barZ)
  }
  const floor = document.querySelector<HTMLElement>('.floor')
  const send = (type: string, y: number) =>
    floor?.dispatchEvent(
      new MouseEvent(type, { clientX: 400, clientY: y, button: 0, bubbles: true }),
    )
  send('pointerdown', 600)
  for (const y of [580, 500, 400, 300, 200]) {
    send('pointermove', y)
    frame()
  }
  send('pointerup', 200)
  frame()
  const windows = [...document.querySelectorAll<HTMLElement>('.window')]
  const under = windows.filter((one) => {
    const [, y] = (/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(one.style.transform) ?? [])
      .slice(1)
      .map(Number)
    return (y ?? 0) < 40
  })
  expect(under.length).toBeGreaterThan(0)
  for (const one of under) {
    expect(one.style.clipPath).toBe('')
    expect((one.nextElementSibling as HTMLElement | null)?.style.visibility).toBe('hidden')
  }
  expect(pane?.style.clipPath).toMatch(/^inset\(/)
  expect(document.querySelector('.band')).toBe(null)
  expect(bar.style.getPropertyValue('--overview-bar')).toBe('1')
  const top = document.querySelector<HTMLElement>('.top')
  expect(top?.style.getPropertyValue('--overview-top')).toBe('40px')
  tabOverview.open = false
  flushSync()
  for (let i = 0; i < 400 && waiting.size; i++) frame()
  expect(bar.style.getPropertyValue('--overview-bar')).toBe('')
})
