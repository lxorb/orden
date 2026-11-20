import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { idle } from './settle'

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia
Element.prototype.scrollIntoView = () => undefined
let drawn: (() => void)[] = []
vi.mock('../../src/lib/reading/src/api', () => ({
  readingHtml: () => new Promise<string>((done) => drawn.push(() => done('<p>Some words of it.</p>'))),
  unreadableHtml: (text: string) => text,
}))
const { default: Overview } = await import('../../src/lib/overview/src/Overview.svelte')
const { tabOverview } = await import('../../src/lib/workspace/src/api')
const { workspace } = await import('../../src/lib/workspace/src/api')
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
  pane.innerHTML = '<div class="head"></div><div>' + '<p><span>Words</span></p>'.repeat(40) + '</div>'
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
test('the windows set off on the first frame, their marks standing in for what is not drawn yet', () => {
  tabOverview.open = true
  flushSync()
  expect(drawn).toEqual([])
  frame()
  frame()
  expect(tabOverview.out.length).toBeGreaterThan(0)
  expect(document.querySelector('.window .face .mark')).not.toBe(null)
})
test('a web page whose picture is still being taken keeps the windows waiting a few frames at most', async () => {
  const { pages } = await import('../../src/lib/web-tab/src/pages.svelte')
  vi.spyOn(pages, 'holdStill').mockReturnValue(new Promise<void>(() => undefined))
  tabOverview.open = true
  flushSync()
  await drawnNow()
  for (let i = 0; i < 8; i++) frame()
  expect(tabOverview.out.length).toBeGreaterThan(0)
})
test('the first frame that moves moves by one frame, however long the frame before it took', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  frame()
  frame(400)
  const open = Number(document.querySelector<HTMLElement>('.top')?.style.opacity)
  expect(open).toBeGreaterThan(0)
  expect(open).toBeLessThan(0.3)
})
const OWN = new Set(['--overview-bar'])
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
        written.set(one, (written.get(one) ?? new Set()).add(`${name}=${style.getPropertyValue(name)}`))
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
test('a window chosen from behind the pane goes home as that pane in one move, and the tab it shows goes to its strip', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  for (let i = 0; i < 400 && waiting.size; i++) frame()
  const paneId = workspace.panes.all[0]?.id ?? ''
  const pane = document.querySelector<HTMLElement>(`[data-pane="${paneId}"]`)
  const was = workspace.activeTabId
  const chosen = workspace.tabs.find((one) => one.id !== was)
  const windowOf = (id: string | null | undefined) =>
    [...document.querySelectorAll<HTMLElement>('.window')].find(
      (one) => one.getAttribute('aria-label') === workspace.tabs.find((tab) => tab.id === id)?.shown,
    )
  const at = (style: string | undefined) =>
    (/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(style ?? '') ?? []).slice(1).map(Number)
  const [x, y] = at(windowOf(chosen?.id)?.style.transform)
  windowOf(chosen?.id)?.click()
  flushSync()
  expect(workspace.activeTabId).toBe(chosen?.id)
  const [px, py] = at(pane?.style.transform)
  expect(px).toBeCloseTo(x ?? NaN, 0)
  expect(py).toBeCloseTo((y ?? NaN) - 40, 0)
  expect(windowOf(chosen?.id)?.querySelector('.face')).toBe(null)
  expect(windowOf(was)?.querySelector('.face')).not.toBe(null)
  let frames = 0
  for (let i = 0; i < 400 && tabOverview.out.length; i++) {
    frame()
    if (!tabOverview.out.length) break
    frames++
    expect(pane?.style.transform).toMatch(/translate\(.*\) scale\(/)
    expect(tabOverview.lifted).not.toContain(paneId)
  }
  expect(frames).toBeGreaterThan(5)
  expect(pane?.getAttribute('style') ?? '').toBe('')
})
test('a picture that comes in while the windows fly is drawn once they are there, its mark till then', async () => {
  tabOverview.open = true
  flushSync()
  await faces.read()
  for (let i = 0; i < 20; i++) frame()
  await idle(30)
  flushSync()
  expect(drawn.length).toBeGreaterThan(0)
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
  for (let i = 0; i < 5; i++) {
    frame()
    await idle(20)
  }
  expect(faceOf()?.querySelector('.read')?.textContent).toContain('Some words of it.')
})
test('a window drawn before is drawn again in the frames after the first, never read again', async () => {
  tabOverview.open = true
  flushSync()
  for (let i = 0; i < 5; i++) {
    frame()
    await idle(20)
    await drawnNow()
  }
  for (let i = 0; i < 200 && waiting.size; i++) frame()
  tabOverview.open = false
  flushSync()
  for (let i = 0; i < 200 && waiting.size; i++) frame()
  tabOverview.open = true
  flushSync()
  expect(drawn).toEqual([])
  expect(document.querySelector('.window .face .read')).toBe(null)
  for (let i = 0; i < 10; i++) {
    frame()
    await idle(20)
  }
  for (let i = 0; i < 200 && waiting.size; i++) frame()
  for (let i = 0; i < 5; i++) {
    frame()
    await idle(20)
  }
  expect(drawn).toEqual([])
  expect(document.querySelector('.window .face .read')?.textContent).toContain('Some words of it.')
})
test('a zoom moves only the camera while it turns, and lines and names are fitted to it once it rests', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  for (let i = 0; i < 400 && waiting.size; i++) frame()
  const world = document.querySelector<HTMLElement>('.world')
  const line = () => world?.style.getPropertyValue('--overview-line')
  const rings = () =>
    [...document.querySelectorAll<HTMLElement>('.ring')].map((one) => one.style.getPropertyValue('--overview-line'))
  const before = line()
  const ringsBefore = rings()
  const at = () => world?.style.transform
  const start = at()
  for (let i = 0; i < 30; i++) {
    if (i % 3 === 0)
      document
        .querySelector('.canvas')
        ?.dispatchEvent(
          new WheelEvent('wheel', { deltaY: 100, clientX: 400, clientY: 300, bubbles: true, cancelable: true }),
        )
    frame()
    expect(line()).toBe(before)
    expect(rings()).toEqual(ringsBefore)
  }
  expect(at()).not.toBe(start)
  await idle(250)
  flushSync()
  expect(line()).not.toBe(before)
})
test('each tab is copied once, riding its pane while in front, a chip otherwise, and the copy moves with a pick', async () => {
  const strip = workspace.tabs.map((tab, index) => {
    const one = document.createElement('div')
    one.dataset.box = tab.id
    one.textContent = tab.shown
    one.getBoundingClientRect = () => new DOMRect(index * 120, 40, 110, 32)
    document.body.append(one)
    return one
  })
  onTestFinished(() => strip.forEach((one) => one.remove()))
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((one) => {
    const style = real(one)
    return Object.assign([], { getPropertyValue: (name: string) => style.getPropertyValue(name) }) as never
  })
  tabOverview.open = true
  flushSync()
  await drawnNow()
  const copies = () => document.querySelectorAll('.canvas .chip-copy > *, .canvas .rider > *').length
  await vi.waitFor(async () => {
    frame()
    await idle(20)
    expect(copies()).toBe(workspace.tabs.length)
  })
  for (let i = 0; i < 400 && waiting.size; i++) frame()
  const front = workspace.activeTabId
  const rider = () => [...document.querySelectorAll('.canvas .rider > *')].map((one) => one.textContent)
  expect(rider()).toEqual([workspace.tabs.find((one) => one.id === front)?.shown])
  const other = workspace.tabs.find((one) => one.id !== front)
  ;[...document.querySelectorAll<HTMLElement>('.window')]
    .find((one) => one.getAttribute('aria-label') === other?.shown)
    ?.click()
  flushSync()
  expect(copies()).toBe(workspace.tabs.length)
  expect(rider()).toEqual([other?.shown])
})
test('a pointer moving over the ground asks nothing of the page, and asks where the names are only when pressed', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  for (let i = 0; i < 400 && waiting.size; i++) frame()
  const floor = document.querySelector<HTMLElement>('.floor')
  const asked = vi.spyOn(document, 'querySelectorAll')
  for (let i = 0; i < 10; i++)
    floor?.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + i * 10, clientY: 300, bubbles: true }))
  expect(asked.mock.calls.filter(([one]) => one.includes('data-space-name'))).toEqual([])
  expect(floor?.style.cursor ?? '').toBe('')
})
test('a frame of the way out writes no value that every element under it inherits', async () => {
  tabOverview.open = true
  flushSync()
  await drawnNow()
  const inherited = new Set<string>()
  for (let i = 0; i < 12; i++) {
    frame()
    for (const one of document.querySelectorAll<HTMLElement>('*')) {
      if (one.querySelectorAll('*').length < 40) continue
      for (let k = 0; k < one.style.length; k++) {
        const name = one.style.item(k)
        if (name.startsWith('--') && name !== '--overview-bar') inherited.add(`${one.className || one.tagName} ${name}`)
      }
    }
  }
  expect([...inherited]).toEqual([])
})
test('the opening builds no picture of a pane and no copy of a tab, and they come in the frames after', async () => {
  const strip = workspace.tabs.map((tab, index) => {
    const one = document.createElement('div')
    one.dataset.box = tab.id
    one.textContent = tab.shown
    one.getBoundingClientRect = () => new DOMRect(index * 120, 40, 110, 32)
    document.body.append(one)
    return one
  })
  onTestFinished(() => strip.forEach((one) => one.remove()))
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((one) => {
    const style = real(one)
    return Object.assign([], { getPropertyValue: (name: string) => style.getPropertyValue(name) }) as never
  })
  const taken = vi.spyOn(faces, 'take')
  tabOverview.open = true
  flushSync()
  expect(taken).not.toHaveBeenCalled()
  expect(document.querySelectorAll('.canvas .chip-copy').length).toBe(0)
  expect(document.querySelectorAll('.canvas .rider > *').length).toBe(1)
  await vi.waitFor(async () => {
    frame()
    await idle(20)
    expect(document.querySelectorAll('.canvas .chip-copy > *, .canvas .rider > *').length).toBe(workspace.tabs.length)
  })
  expect(taken).toHaveBeenCalled()
})
test('nothing is measured once the overview is in the page, until its first frame', () => {
  let laidOut = 0
  const strip = workspace.tabs.map((tab, index) => {
    const one = document.createElement('div')
    one.dataset.box = tab.id
    one.getBoundingClientRect = () => {
      if (document.querySelector('.canvas')) laidOut++
      return new DOMRect(index * 120, 40, 110, 32)
    }
    document.body.append(one)
    return one
  })
  onTestFinished(() => strip.forEach((one) => one.remove()))
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((one) => {
    const style = real(one)
    return Object.assign([], { getPropertyValue: (name: string) => style.getPropertyValue(name) }) as never
  })
  const counted = (name: 'getBoundingClientRect' | 'getClientRects') => {
    const real = Object.getOwnPropertyDescriptor(Element.prototype, name)?.value as (this: Element) => unknown
    vi.spyOn(Element.prototype, name).mockImplementation(function (this: Element) {
      if (document.querySelector('.canvas')) laidOut++
      return real.call(this)
    } as never)
  }
  counted('getBoundingClientRect')
  counted('getClientRects')
  tabOverview.open = true
  flushSync()
  expect(document.querySelector('.canvas .window')).not.toBe(null)
  expect(laidOut).toBe(0)
})
test('the windows’ pictures come in together, in the frame after the windows land', async () => {
  tabOverview.open = true
  flushSync()
  for (let i = 0; i < 6; i++) {
    frame()
    await idle(20)
    await drawnNow()
  }
  const drawnNowCount = () => document.querySelectorAll('.window .face .read').length
  const seen: number[] = []
  let landed = -1
  for (let i = 0; i < 300 && waiting.size; i++) {
    const before = [...document.querySelectorAll<HTMLElement>('.window')].map((one) => one.style.transform).join('|')
    frame()
    const after = [...document.querySelectorAll<HTMLElement>('.window')].map((one) => one.style.transform).join('|')
    if (before !== after) landed = i
    seen.push(drawnNowCount())
  }
  const first = seen.findIndex((one) => one > 0)
  expect(first).toBeGreaterThan(landed)
  expect(seen[first]).toBe(Math.max(...seen))
})
test('the windows’ crosses and names come in the frames after the first, which draws only the windows', async () => {
  tabOverview.open = true
  flushSync()
  expect(document.querySelectorAll('.canvas .window').length).toBeGreaterThan(0)
  expect(document.querySelectorAll('.closer, .caption').length).toBe(0)
  await vi.waitFor(async () => {
    frame()
    await idle(20)
    expect(document.querySelectorAll('.closer').length).toBe(document.querySelectorAll('.canvas .window').length)
  })
  expect(document.querySelectorAll('.caption').length).toBe(document.querySelectorAll('.canvas .window').length)
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
    await idle(60)
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
  await vi.waitFor(async () => {
    frame()
    await idle(20)
    expect(document.querySelector('.closer')).not.toBe(null)
  })
  const pane = document.querySelector<HTMLElement>(`[data-pane="${workspace.panes.all[0]?.id}"]`)
  for (let i = 0; i < 200 && waiting.size; i++) {
    frame()
    if (pane?.style.zIndex) expect(rung(pane.style.zIndex)).toBeLessThan(barZ)
  }
  const floor = document.querySelector<HTMLElement>('.floor')
  const send = (type: string, y: number) =>
    floor?.dispatchEvent(new MouseEvent(type, { clientX: 400, clientY: y, button: 0, bubbles: true }))
  send('pointerdown', 600)
  for (const y of [580, 500, 400, 300, 200]) {
    send('pointermove', y)
    frame()
  }
  send('pointerup', 200)
  frame()
  const windows = [...document.querySelectorAll<HTMLElement>('.window')]
  const under = windows.filter((one) => {
    const [, y] = (/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(one.style.transform) ?? []).slice(1).map(Number)
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
