import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EDGE, EdgePeek, GRACE, type Room } from './edge-peek.svelte'

/** The file list, shut, brought out by the pointer reaching the window's edge, and
 *  gone again once it has left (#1034); see edge-peek.svelte.ts. Played on a clock this
 *  test turns, in a window it describes. */

const WIDTH = 1200
/** Where the list is once it is out: the first 250 pixels of the window. */
const LIST = 250

let room: Room & { allowed: boolean; busied: boolean; rightToLeft: boolean }
let peek: EdgePeek
let stop: () => void

beforeEach(() => {
  vi.useFakeTimers()
  room = {
    allowed: true,
    busied: false,
    rightToLeft: false,
    may: () => room.allowed,
    width: () => WIDTH,
    rtl: () => room.rightToLeft,
    over: (x) => (room.rightToLeft ? x >= WIDTH - LIST : x <= LIST),
    busy: () => room.busied,
  }
  peek = new EdgePeek()
  stop = peek.watch(room)
})

afterEach(() => {
  stop()
  vi.useRealTimers()
})

const at = (clientX: number, buttons = 0, pointerType = 'mouse') =>
  peek.moved({ clientX, clientY: 300, buttons, pointerType })

describe('the pointer at the edge', () => {
  test('brings the list out on the move that reaches it, with no wait for it to rest', () => {
    at(400)
    expect(peek.out).toBe(false)
    at(0)
    expect(peek.out).toBe(true)
  })

  test('so a pointer passing it on its way brings it out as well, and goes on past it', () => {
    at(0)
    at(600)
    expect(peek.out).toBe(true)
    vi.advanceTimersByTime(GRACE)
    expect(peek.out).toBe(false)
  })

  test('a pixel or two in from the edge is still at it', () => {
    at(EDGE)
    expect(peek.out).toBe(true)
  })

  test('nor with a button held: a selection, a row or a tab being carried', () => {
    at(0, 1)
    vi.advanceTimersByTime(GRACE * 2)
    expect(peek.out).toBe(false)
  })

  test('nor with a finger, whose drawer has an edge of its own', () => {
    at(0, 0, 'touch')
    vi.advanceTimersByTime(GRACE * 2)
    expect(peek.out).toBe(false)
  })

  test('nor where it may not: open already, a drawer, full screen, a menu up', () => {
    room.allowed = false
    at(0)
    vi.advanceTimersByTime(GRACE * 2)
    expect(peek.out).toBe(false)
  })

  test('is the right edge where the window reads right to left', () => {
    room.rightToLeft = true
    at(0)
    expect(peek.out).toBe(false)
    at(WIDTH - 1)
    expect(peek.out).toBe(true)
  })
})

describe('the list out over the note', () => {
  beforeEach(() => {
    at(0)
  })

  test('stays while the pointer is over it', () => {
    at(120)
    vi.advanceTimersByTime(GRACE * 4)
    expect(peek.out).toBe(true)
  })

  test('stays while the pointer rests at the edge that brought it out, outside the card', () => {
    at(1)
    at(0)
    at(2)
    vi.advanceTimersByTime(GRACE * 4)
    expect(peek.out).toBe(true)
  })

  test('goes a moment after the pointer leaves it', () => {
    at(600)
    vi.advanceTimersByTime(GRACE - 1)
    expect(peek.out).toBe(true)
    vi.advanceTimersByTime(1)
    expect(peek.out).toBe(false)
  })

  test('and stays for a pointer that slipped past its edge and came back', () => {
    at(600)
    vi.advanceTimersByTime(GRACE / 2)
    at(200)
    vi.advanceTimersByTime(GRACE * 2)
    expect(peek.out).toBe(true)
  })

  test('stays while it is busy, and goes once it is not', () => {
    room.busied = true
    at(600)
    vi.advanceTimersByTime(GRACE * 3)
    expect(peek.out).toBe(true)

    room.busied = false
    vi.advanceTimersByTime(GRACE)
    expect(peek.out).toBe(false)
  })

  test('goes when the pointer leaves the window', () => {
    peek.away()
    vi.advanceTimersByTime(GRACE)
    expect(peek.out).toBe(false)
  })

  test('goes at once when put away', () => {
    peek.hide()
    expect(peek.out).toBe(false)
  })

  test('and nothing is left listening once the window stops watching', () => {
    stop()
    expect(peek.out).toBe(false)
    at(0)
    expect(peek.out).toBe(false)
    stop = peek.watch(room)
  })
})

describe('the right side, at the other edge (#1038)', () => {
  let end: EdgePeek
  let off: () => void
  /** The bar's height: the right side stands under it. */
  const BAR = 38

  beforeEach(() => {
    end = new EdgePeek(true)
    off = end.watch({
      ...room,
      top: () => BAR,
      over: (x) => (room.rightToLeft ? x <= LIST : x >= WIDTH - LIST),
    })
  })

  afterEach(() => off())

  const near = (clientX: number, clientY = 300) =>
    end.moved({ clientX, clientY, buttons: 0, pointerType: 'mouse' })

  test('comes out at the end edge, not the start one', () => {
    near(0)
    expect(end.out).toBe(false)
    near(WIDTH - 1)
    expect(end.out).toBe(true)
  })

  test('and at the start edge where the window reads right to left', () => {
    room.rightToLeft = true
    near(WIDTH - 1)
    expect(end.out).toBe(false)
    near(0)
    expect(end.out).toBe(true)
  })

  test("not beside the bar, where the edge is the window's buttons' corner", () => {
    near(WIDTH - 1, BAR - 1)
    expect(end.out).toBe(false)
    near(WIDTH - 1, BAR)
    expect(end.out).toBe(true)
  })

  test('stays while the pointer rests at its own edge', () => {
    near(WIDTH - 1)
    near(WIDTH - 2)
    vi.advanceTimersByTime(GRACE * 2)
    expect(end.out).toBe(true)
  })

  test('goes once the pointer has left it, after the same grace', () => {
    near(WIDTH - 1)
    near(400)
    vi.advanceTimersByTime(GRACE)
    expect(end.out).toBe(false)
  })
})

/** What the left side asks before the list comes out, and what it is once it is: read
 *  out of Sidebar.svelte, which is where the window is described to it. */
describe('each side', () => {
  const sidebar = readFileSync(new URL('./Sidebar.svelte', import.meta.url), 'utf8')

  test('lets it out only shut, as a column, outside full screen and under nothing', () => {
    for (const rule of [
      "(side === 'left' ? workspace.panel === null : workspace.rightShows === null)",
      '!viewport.drawer',
      '!fullscreen.on',
      '!alone.on',
      'workspace.panes.fills === null',
      'overlays.depth === 0',
    ])
      expect(sidebar, rule).toContain(rule)
    expect(sidebar).toMatch(
      /if \(viewport\.touch \|\| \(side === 'right' && !sideToggles\.inside\)\) return\s+const stop = peeker\.watch\(/,
    )
    expect(sidebar).toContain("const peeker = $derived(side === 'left' ? edgePeek : endPeek)")
  })

  test('and out, it is a layer on the stack: Escape, a press past it, a web page stepping aside', () => {
    expect(sidebar).toMatch(
      /peek\s*\?\s*overlays\.show\(\s*\(\) => peeker\.hide\(\),\s*\(\) => \[aside\],?\s*\)/,
    )
  })

  test('over the note, keeping no room, so nothing beside it moves', () => {
    expect(sidebar).toMatch(/\.column\.shut\.floating aside \{\s*position: absolute;/)
  })

  /** The rule of the block, by its selector, out of the component's stylesheet. */
  const rule = (selector: string) => {
    const at = sidebar.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThan(-1)
    return sidebar.slice(at, sidebar.indexOf('}', at))
  }

  /** #1034, the class of #1050: nothing waits a frame or plays slowly between the
   *  pointer reaching the edge and the list following it. */
  test('slides in on the style change that floats it: shut, it already stands past the edge', () => {
    expect(
      rule(
        ':global(:root:not([data-touch], [data-drawer])) .column.shut:not(.moving, .right, .peek) aside',
      ),
    ).toMatch(/transform: translateX\(calc\(var\(--dir\) \* \(-100%/)
    expect(
      rule(
        ':global(:root:not([data-touch], [data-drawer])) .column.right.shut:not(.moving, .peek) aside',
      ),
    ).toMatch(/transform: translateX\(calc\(var\(--dir\) \* \(100%/)
    expect(rule('.column.shut.floating.peek aside')).toMatch(/transform: none;/)
    const effect = sidebar.slice(sidebar.indexOf('let floating = $state(false)'))
    expect(effect.slice(0, effect.indexOf('/** Whether a row is being carried'))).not.toMatch(
      /requestAnimationFrame|tick\(/,
    )
  })

  test('and quickly, quickest at its start, and gone as quickly', () => {
    expect(rule('.column.shut.floating aside')).toMatch(
      /transition: transform var\(--dur-fast\) var\(--ease-out\) -16ms;/,
    )
    expect(sidebar).toMatch(/setTimeout\(\(\) => \(floating = false\), dur\(130\)\)/)
    expect(GRACE).toBeLessThanOrEqual(150)
  })

  test('a card over the note: in from the edges, rounded, with the card shadow', () => {
    const card = rule('.column.shut.floating aside')
    for (const token of [
      'inset-block: var(--card-inset);',
      'inset-inline-start: var(--card-inset);',
      'border-radius: var(--card-radius);',
      'var(--card-shadow)',
      'var(--card-edge)',
      'border: 0;',
    ])
      expect(card, token).toContain(token)
    expect(rule('.column.right.shut.floating aside')).toContain(
      'inset-inline: auto var(--card-inset);',
    )
  })

  /** The bar a filled window brings down at its top edge is the same gesture, and keeps
   *  the same rules: at once, and gone after the same grace. */
  test("a filled window's top bar comes at once too, and goes after the same grace", () => {
    const bar = readFileSync(new URL('./tab-fill/FillBar.svelte', import.meta.url), 'utf8')
    expect(bar).toContain('const GOES_AFTER = GRACE')
    const moved = bar.slice(bar.indexOf('function moved('), bar.indexOf('function letGo('))
    expect(moved).not.toContain('setTimeout')
    expect(moved).toMatch(/if \(!atEdge\(y\)\) return\s+shown = true/)
  })
})
