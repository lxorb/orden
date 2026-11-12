import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EDGE, EdgePeek, GRACE, type Room } from './edge-peek.svelte'

const WIDTH = 1200
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
    over: (x) => x <= LIST,
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

describe('the left side', () => {
  const sidebar = readFileSync(join(import.meta.dirname, './Sidebar.svelte'), 'utf8')

  test('lets it out only shut, as a column, outside full screen and under nothing', () => {
    for (const rule of [
      'workspace.panel === null',
      '!viewport.drawer',
      '!fullscreen.on',
      '!alone.on',
      'workspace.panes.fills === null',
      'overlays.depth === 0',
    ])
      expect(sidebar, rule).toContain(rule)
    expect(sidebar).toMatch(
      /if \(viewport\.touch \|\| side === 'right'\) return\s+const stop = edgePeek\.watch\(/,
    )
    expect(sidebar).toContain("const peek = $derived(side === 'left' && shut && edgePeek.out)")
    expect(sidebar).not.toContain('endPeek')
  })

  test('and out, it is a layer on the stack: Escape, a press past it, a web page stepping aside', () => {
    expect(sidebar).toMatch(
      /peek\s*\?\s*overlays\.peek\(\s*\(\) => edgePeek\.hide\(\),\s*\(\) => \[aside\],?\s*\)/,
    )
  })

  test('over the note, keeping no room, so nothing beside it moves', () => {
    expect(sidebar).toMatch(/\.column\.shut\.floating aside \{\s*position: absolute;/)
  })

  const rule = (selector: string) => {
    const at = sidebar.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThan(-1)
    return sidebar.slice(at, sidebar.indexOf('}', at))
  }

  test('slides in on the style change that floats it: shut, it already stands past the edge', () => {
    expect(
      rule(
        ':global(:root:not([data-touch], [data-drawer])) .column.shut:not(.moving, .right, .peek) aside',
      ),
    ).toMatch(/transform: translateX\(calc\(-100%/)
    expect(
      rule(
        ':global(:root:not([data-touch], [data-drawer])) .column.right.shut:not(.moving, .peek) aside',
      ),
    ).toMatch(/transform: translateX\(calc\(100%/)
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
  })

  test("a filled window's top bar comes at once too, and goes after the same grace", () => {
    const bar = readFileSync(join(import.meta.dirname, './tab-fill/FillBar.svelte'), 'utf8')
    expect(bar).toContain('const GOES_AFTER = GRACE')
    const moved = bar.slice(bar.indexOf('function moved('), bar.indexOf('function letGo('))
    expect(moved).not.toContain('setTimeout')
    expect(moved).toMatch(/if \(!atEdge\(y\)\) return\s+shown = true/)
  })
})
