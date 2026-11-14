import { flushSync } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import recorded from './swipe-replays.json'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  isMobile: false,
  invoke: () => Promise.resolve(undefined),
}))

const pressed: string[] = []
const note = { id: 'n1', kind: 'note', paneId: 'p1', canGoBack: true, canGoForward: false }
const site = { id: 'w1', kind: 'web', paneId: 'p2', canGoBack: false, canGoForward: false }
const shownIn = new SvelteMap<string, unknown>()

vi.mock('../../src/lib/workspace.svelte', () => ({
  workspace: {
    tabs: [note, site],
    showing: (pane: string) => shownIn.get(pane) ?? null,
    goBack: (id: string) => {
      pressed.push(`back ${id}`)
      note.canGoForward = true
    },
    goForward: (id: string) => pressed.push(`forward ${id}`),
  },
}))

vi.mock('../../src/lib/web-tab/pages.svelte', () => ({
  pages: { of: () => ({ back: true, forward: false, zoom: 2 }) },
}))

Element.prototype.getBoundingClientRect = function box(this: Element): DOMRect {
  const strip = this.classList.contains('head')
  const rect = { x: 0, y: 0, width: 800, height: strip ? 40 : 600 }
  return { ...rect, top: 0, left: 0, right: 800, bottom: rect.height, toJSON: () => rect }
}

const { HOLD, listen, pageSaid, PLAYS, readFingers, touchpad } =
  await import('../../src/lib/back-swipe/swipes')
const { QUIET, SETTLE } = await import('../../src/lib/back-swipe/gesture')
const { swipeChoice } = await import('../../src/lib/back-swipe/choice.svelte')
const { swiping } = await import('../../src/lib/back-swipe/shown.svelte')
const { overlays } = await import('../../src/lib/ui-kit/src/overlays')

let stop: () => void
let words: HTMLElement
let strip: HTMLElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  pressed.length = 0
  note.canGoForward = false
  shownIn.set('p1', note)
  shownIn.set('p2', site)
  swipeChoice.set(true)
  document.body.innerHTML = `
    <div data-pane="p1">
      <div class="head" data-chrome="top"><div class="strip"></div></div>
      <div class="words"><p>A note.</p></div>
    </div>
    <div data-pane="p2"><div class="hole"></div></div>`
  words = found('[data-pane="p1"] .words p')
  strip = found('[data-pane="p1"] .strip')
  stop = listen()
})

afterEach(() => {
  stop()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

let clock = 1000
const STEP = 8

function stamped<T extends Event>(event: T): T {
  clock += STEP
  Object.defineProperty(event, 'timeStamp', { value: clock })
  return event
}

function sweep(at: Element, steps: number, dx: number, init: WheelEventInit = {}, notch = 0) {
  for (let one = 0; one < steps; one++) {
    const event = stamped(
      new WheelEvent('wheel', { deltaX: dx, deltaMode: 0, bubbles: true, ...init }),
    )
    if (notch) Object.defineProperty(event, 'wheelDeltaX', { value: notch })
    at.dispatchEvent(event)
  }
  flushSync()
}

function letGo() {
  vi.advanceTimersByTime(QUIET + 1)
  flushSync()
}

const arrow = () => document.querySelector('.orden-swipe')

function found(selector: string): HTMLElement {
  const one = document.querySelector<HTMLElement>(selector)
  if (!one) throw new Error(`nothing is ${selector}`)
  return one
}

test('a long sweep towards the left brings the arrow in and goes back, once', () => {
  sweep(words, 40, -10)
  expect(arrow()).not.toBeNull()
  expect(swiping.tab).toBe('n1')
  expect(swiping.side).toBe('left')
  expect(arrow()?.classList.contains('armed')).toBe(true)
  expect(pressed).toEqual([])

  letGo()
  expect(pressed).toEqual(['back n1'])
  expect(arrow()?.classList.contains('went')).toBe(true)

  vi.advanceTimersByTime(PLAYS + 1)
  flushSync()
  expect(arrow()).toBeNull()
  expect(pressed).toEqual(['back n1'])
})

test('a short sweep shows the arrow and goes nowhere', () => {
  sweep(words, 12, -10)
  expect(arrow()).not.toBeNull()
  letGo()
  expect(pressed).toEqual([])
  expect(arrow()?.classList.contains('stayed')).toBe(true)
})

test('the ring round the arrow fills with the way to where letting go goes', () => {
  const left = () =>
    Number(document.querySelector<SVGElement>('.ring circle')?.style.strokeDashoffset)
  sweep(words, 12, -10)
  expect(swiping.progress).toBeGreaterThan(0)
  expect(swiping.progress).toBeLessThan(1)
  expect(left()).toBeCloseTo(1 - swiping.progress)

  sweep(words, 40, -10)
  expect(left()).toBe(0)
  expect(arrow()?.classList.contains('armed')).toBe(true)
  letGo()
})

test('nowhere to go forward is no arrow at all', () => {
  sweep(words, 40, 10)
  expect(arrow()).toBeNull()
  letGo()
  expect(pressed).toEqual([])
})

test('the strip, a held key and a tilted wheel are not swipes', () => {
  sweep(strip, 40, -10)
  sweep(words, 40, -10, { shiftKey: true })
  sweep(words, 40, -100, {}, 120)
  letGo()
  expect(arrow()).toBeNull()
  expect(pressed).toEqual([])
})

test('a scroll the content can take is the content s', () => {
  const wide = document.createElement('div')
  wide.style.overflowX = 'auto'
  Object.defineProperties(wide, {
    scrollWidth: { value: 2000 },
    clientWidth: { value: 500 },
    scrollLeft: { value: 300, writable: true },
  })
  const cell = document.createElement('span')
  wide.append(cell)
  words.append(wide)

  sweep(cell, 40, -10)
  letGo()
  expect(pressed).toEqual([])

  wide.scrollLeft = 0
  sweep(cell, 40, -10)
  letGo()
  expect(pressed).toEqual(['back n1'])
})

test('a stream that moved a scroller is the scroller s, though it is at its edge when asked', () => {
  const wide = document.createElement('div')
  wide.style.overflowX = 'auto'
  Object.defineProperties(wide, {
    scrollWidth: { value: 506 },
    clientWidth: { value: 500 },
    scrollLeft: { value: 6, writable: true },
  })
  const cell = document.createElement('span')
  wide.append(cell)
  words.append(wide)
  wide.dispatchEvent(stamped(new Event('scroll')))
  clock += 1000

  wide.scrollLeft = 0
  wide.dispatchEvent(stamped(new Event('scroll')))
  sweep(cell, 40, -10)
  expect(arrow()).toBeNull()
  letGo()
  expect(pressed).toEqual([])

  clock += 1000
  sweep(cell, 40, -10)
  expect(arrow()).not.toBeNull()
  letGo()
  expect(pressed).toEqual(['back n1'])
})

test('a scroll a surface kept for itself is the surface s', () => {
  words.addEventListener('wheel', (event) => event.preventDefault(), { passive: false })
  sweep(words, 40, -10, { cancelable: true })
  letGo()
  expect(pressed).toEqual([])
})

test('switched off, a swipe is a scroll and nothing else', () => {
  swipeChoice.set(false)
  sweep(words, 40, -10)
  letGo()
  expect(arrow()).toBeNull()
  expect(pressed).toEqual([])
})

test('a page s swipe, said by the crate, steps its tab in the window s pixels', () => {
  for (let at = 0; at < 20; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: false, right: false })
  }
  flushSync()
  expect(swiping.tab).toBe('w1')
  letGo()
  expect(pressed).toEqual(['back w1'])
})

test('a page hidden behind its picture mid swipe hands the rest of the swipe to the window', () => {
  for (let at = 0; at < 4; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: false, right: false })
  }
  flushSync()
  const before = swiping.travel
  expect(before).toBeGreaterThan(0)
  sweep(found('.hole'), 5, -10)
  expect(swiping.travel).toBe(before + 50)
  sweep(found('.hole'), 20, -10)
  letGo()
  expect(pressed).toEqual(['back w1'])
})

test('the window keeps out of a page s swipe it has no arrow for', () => {
  sweep(found('.hole'), 40, -10)
  letGo()
  expect(swiping.tab).toBeNull()
  expect(pressed).toEqual([])
})

test('a page that took the scroll says so, and keeps it', () => {
  for (let at = 0; at < 20; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: true, right: true })
  }
  letGo()
  expect(pressed).toEqual([])
})

test('a scroll down that drifts sideways is a scroll down, to its end', () => {
  sweep(words, 10, 0, { deltaY: 10 })
  sweep(words, 40, -10, { deltaY: 1 })
  expect(arrow()).toBeNull()
  letGo()
  expect(pressed).toEqual([])

  pageSaid({ tab: 'w1', kind: 'wheel', dx: -1, dy: 120, at: 0, left: false, right: false })
  for (let at = 1; at < 20; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: false, right: false })
  }
  flushSync()
  expect(arrow()).toBeNull()
  letGo()
  expect(pressed).toEqual([])
})

test('one swipe is one step: the coast that carries on after it is nobody s', () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
  sweep(words, 40, -10)
  letGo()
  expect(pressed).toEqual(['back n1'])

  sweep(words, 40, -10)
  letGo()
  expect(pressed).toEqual(['back n1'])

  now.mockReturnValue(10_000 + SETTLE + 1)
  sweep(words, 40, -10)
  letGo()
  expect(pressed).toEqual(['back n1', 'back n1'])
  now.mockRestore()
})

test('a finger from the side of the pane goes back when it lifts far enough along', () => {
  const touch = (type: string, x: number) => {
    const event = stamped(new Event(type, { bubbles: true })) as Event & { touches: unknown[] }
    Object.defineProperty(event, 'touches', {
      value: type === 'touchend' ? [] : [{ clientX: x, clientY: 300 }],
    })
    words.dispatchEvent(event)
  }
  touch('touchstart', 4)
  for (let x = 14; x <= 404; x += 10) touch('touchmove', x)
  flushSync()
  expect(swiping.tab).toBe('n1')
  expect(pressed).toEqual([])
  touch('touchend', 404)
  expect(pressed).toEqual(['back n1'])

  pressed.length = 0
  touch('touchstart', 300)
  for (let x = 310; x <= 700; x += 10) touch('touchmove', x)
  touch('touchend', 700)
  expect(pressed).toEqual([])
})

test('over a web page the arrow comes in over the page s picture, and is a layer of its own', async () => {
  const { layersOver } = await import('../../src/lib/web-tab/covers')
  const hole = found('.hole')
  expect(layersOver(hole)).toEqual([])

  for (let at = 0; at < 20; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: false, right: false })
  }
  flushSync()
  expect(layersOver(hole).map((one) => one.scrim)).toEqual([true, false])

  letGo()
  vi.advanceTimersByTime(PLAYS + 1)
  flushSync()
  expect(layersOver(hole)).toEqual([])
})

type Op =
  | ['fingers', number]
  | ['sweep' | 'flick' | 'coast', number, number]
  | ['down', number]
  | ['hold', number]
  | ['expect', string[]]

const { replays } = recorded as unknown as { replays: { name: string; do: Op[] }[] }

function replay(ops: readonly Op[]) {
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const seen: { wanted: string[]; got: string[] }[] = []
  for (const op of ops) {
    switch (op[0]) {
      case 'fingers':
        touchpad(op[1])
        break
      case 'sweep':
        sweep(words, op[1], 10 * op[2])
        break
      case 'flick':
        sweep(words, op[1], 20 * op[2])
        break
      case 'down':
        sweep(words, op[1], 0, { deltaY: 10 })
        break
      case 'coast':
        for (let step = 0; step < op[1]; step++) sweep(words, 1, 10 * op[2] * 0.85 ** (step + 1))
        break
      case 'hold':
        clock += op[1]
        vi.advanceTimersByTime(op[1])
        break
      case 'expect':
        flushSync()
        seen.push({ wanted: op[1].map((way) => `${way} n1`), got: [...pressed] })
        break
    }
  }
  now.mockRestore()
  return seen
}

describe('gestures replayed on a precision touchpad, which says when the fingers lift', () => {
  for (const one of replays) {
    test(one.name, () => {
      for (const { wanted, got } of replay(one.do)) expect(got).toEqual(wanted)
    })
  }

  test('held past the distance, the arrow is armed and waits for the lift', () => {
    replay([
      ['fingers', 2],
      ['sweep', 40, -1],
      ['hold', 2000],
    ])
    expect(arrow()?.classList.contains('armed')).toBe(true)
    expect(arrow()?.classList.contains('went')).toBe(false)
    expect(pressed).toEqual([])
    replay([['fingers', 0]])
    flushSync()
    expect(pressed).toEqual(['back n1'])
    expect(arrow()?.classList.contains('went')).toBe(true)
  })

  test('the arrow comes in with the fingers, pixel for pixel', () => {
    replay([
      ['fingers', 2],
      ['sweep', 12, -1],
    ])
    expect(swiping.travel).toBe(120)
    const box = arrow() as HTMLElement
    expect(box.style.transform).toMatch(new RegExp(`^translate\\(${120 - 40}px, \\d+px\\)$`))
    replay([['sweep', 3, 1]])
    expect(swiping.travel).toBe(90)
    replay([['fingers', 0]])
  })

  test('a page s swipe waits for the fingers too', () => {
    touchpad(2)
    for (let at = 0; at < 20; at++) {
      pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: false, right: false })
    }
    letGo()
    expect(pressed).toEqual([])
    touchpad(0)
    expect(pressed).toEqual(['back w1'])
  })

  test('what the crate says of the fingers is read as a count and nothing else', () => {
    expect(readFingers({ fingers: 2 })).toBe(2)
    expect(readFingers({ fingers: 0 })).toBe(0)
    for (const wrong of [null, 2, {}, { fingers: -1 }, { fingers: 1.5 }, { fingers: '2' }]) {
      expect(readFingers(wrong)).toBeNull()
    }
  })
})

describe('every swipe ends', () => {
  const touch = (type: string, x: number) => {
    const event = stamped(new Event(type, { bubbles: true })) as Event & { touches: unknown[] }
    Object.defineProperty(event, 'touches', {
      value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: 300 }],
    })
    words.dispatchEvent(event)
    flushSync()
  }

  function over() {
    flushSync()
    const left = arrow()
    if (left) expect(['went', 'stayed'].some((one) => left.classList.contains(one))).toBe(true)
    vi.advanceTimersByTime(PLAYS + 1)
    flushSync()
    expect(arrow()).toBeNull()
    expect(swiping.tab).toBeNull()
    expect(swiping.room).toBeNull()
  }

  test('let go while it only leaned sideways, before it was a swipe', () => {
    sweep(words, 4, -10)
    expect(arrow()).not.toBeNull()
    letGo()
    over()
    expect(pressed).toEqual([])
  })

  test('two fingers lifted from a precision touchpad while it only leaned', () => {
    touchpad(2)
    sweep(words, 4, -10)
    expect(arrow()).not.toBeNull()
    touchpad(0)
    over()
    expect(pressed).toEqual([])
  })

  test('a precision touchpad whose lift never comes', () => {
    touchpad(2)
    sweep(words, 40, -10)
    expect(arrow()?.classList.contains('armed')).toBe(true)
    vi.advanceTimersByTime(HOLD - 1)
    flushSync()
    expect(arrow()?.classList.contains('stayed')).toBe(false)
    vi.advanceTimersByTime(1)
    over()
    expect(pressed).toEqual([])
  })

  test('a finger lifted while it only leaned', () => {
    touch('touchstart', 4)
    for (let x = 14; x <= 44; x += 10) touch('touchmove', x)
    expect(arrow()).not.toBeNull()
    touch('touchend', 44)
    over()
    expect(pressed).toEqual([])
  })

  test('a finger cancelled past the distance goes nowhere', () => {
    touch('touchstart', 4)
    for (let x = 14; x <= 404; x += 10) touch('touchmove', x)
    expect(arrow()?.classList.contains('armed')).toBe(true)
    touch('touchcancel', 404)
    over()
    expect(pressed).toEqual([])
  })

  test('a finger whose lift was never heard, landing again', () => {
    touch('touchstart', 4)
    for (let x = 14; x <= 204; x += 10) touch('touchmove', x)
    touch('touchstart', 300)
    over()
    expect(pressed).toEqual([])
  })

  test('a finger whose lift never comes', () => {
    touch('touchstart', 4)
    for (let x = 14; x <= 204; x += 10) touch('touchmove', x)
    vi.advanceTimersByTime(HOLD)
    over()
    expect(pressed).toEqual([])
  })

  test('the window out of sight', () => {
    touchpad(2)
    sweep(words, 20, -10)
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    hidden.mockRestore()
    over()
    touchpad(0)
    expect(pressed).toEqual([])
  })

  for (const [what, then] of [
    ['another tab chosen in the pane', { id: 'n2', kind: 'terminal', paneId: 'p1' }],
    ['the tab closed', null],
  ] as const) {
    test(`${what}: the arrow goes at once, and its lift steps nothing`, () => {
      touchpad(2)
      sweep(words, 40, -10)
      expect(arrow()).not.toBeNull()
      shownIn.set('p1', then)
      flushSync()
      expect(arrow()).toBeNull()
      expect(swiping.tab).toBeNull()
      touchpad(0)
      flushSync()
      expect(pressed).toEqual([])
      expect(arrow()).toBeNull()
    })
  }

  test('a page whose lift comes while a layer is up', () => {
    pageSaid({ tab: 'w1', kind: 'touch', dx: -10, dy: 0, at: 0, left: false, right: false })
    for (let at = 1; at < 20; at++) {
      pageSaid({ tab: 'w1', kind: 'touch', dx: -10, dy: 0, at: at * 8, left: false, right: false })
    }
    expect(swiping.tab).toBe('w1')
    const close = overlays.show(() => undefined)
    pageSaid({ tab: 'w1', kind: 'lift', dx: 0, dy: 0, at: 200, left: false, right: false })
    close()
    over()
    expect(pressed).toEqual(['back w1'])
  })

  test('a page whose end the engine never says', () => {
    for (let at = 0; at < 20; at++) {
      pageSaid({ tab: 'w1', kind: 'touch', dx: -10, dy: 0, at: at * 8, left: false, right: false })
    }
    expect(swiping.tab).toBe('w1')
    vi.advanceTimersByTime(HOLD)
    over()
    expect(pressed).toEqual([])
  })

  test('the setting turned off half way', () => {
    sweep(words, 20, -10)
    swipeChoice.set(false)
    over()
    expect(pressed).toEqual([])
  })
})
