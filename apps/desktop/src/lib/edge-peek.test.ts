import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DWELL, EDGE, EdgePeek, GRACE, type Room } from './edge-peek.svelte'

/** The file list, shut, brought out by the pointer resting at the window's edge, and
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
  test('brings the list out once it has rested there a moment', () => {
    at(0)
    vi.advanceTimersByTime(DWELL - 1)
    expect(peek.out).toBe(false)
    vi.advanceTimersByTime(1)
    expect(peek.out).toBe(true)
  })

  test('a pixel or two in from the edge is still at it', () => {
    at(EDGE)
    vi.advanceTimersByTime(DWELL)
    expect(peek.out).toBe(true)
  })

  test('but not sweeping past it on the way somewhere else', () => {
    at(0)
    vi.advanceTimersByTime(DWELL / 2)
    at(400)
    vi.advanceTimersByTime(DWELL * 2)
    expect(peek.out).toBe(false)
  })

  test('nor with a button held: a selection, a row or a tab being carried', () => {
    at(0, 1)
    vi.advanceTimersByTime(DWELL * 2)
    expect(peek.out).toBe(false)
  })

  test('nor with a finger, whose drawer has an edge of its own', () => {
    at(0, 0, 'touch')
    vi.advanceTimersByTime(DWELL * 2)
    expect(peek.out).toBe(false)
  })

  test('nor where it may not: open already, a drawer, full screen, a menu up', () => {
    room.allowed = false
    at(0)
    vi.advanceTimersByTime(DWELL * 2)
    expect(peek.out).toBe(false)
  })

  test('nor when that changed while it rested there', () => {
    at(0)
    room.allowed = false
    vi.advanceTimersByTime(DWELL)
    expect(peek.out).toBe(false)
  })

  test('is the right edge where the window reads right to left', () => {
    room.rightToLeft = true
    at(0)
    vi.advanceTimersByTime(DWELL)
    expect(peek.out).toBe(false)
    at(WIDTH - 1)
    vi.advanceTimersByTime(DWELL)
    expect(peek.out).toBe(true)
  })
})

describe('the list out over the note', () => {
  beforeEach(() => {
    at(0)
    vi.advanceTimersByTime(DWELL)
  })

  test('stays while the pointer is over it', () => {
    at(120)
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
    vi.advanceTimersByTime(DWELL)
    expect(peek.out).toBe(false)
    stop = peek.watch(room)
  })
})

/** What the left side asks before the list comes out, and what it is once it is: read
 *  out of Sidebar.svelte, which is where the window is described to it. */
describe('the left side', () => {
  const sidebar = readFileSync(new URL('./Sidebar.svelte', import.meta.url), 'utf8')

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
    expect(sidebar).toMatch(/if \(side !== 'left' \|\| viewport\.touch\) return/)
  })

  test('and out, it is a layer on the stack: Escape, a press past it, a web page stepping aside', () => {
    expect(sidebar).toMatch(
      /peek\s*\?\s*overlays\.show\(\s*\(\) => edgePeek\.hide\(\),\s*\(\) => \[aside\],?\s*\)/,
    )
  })

  test('over the note, keeping no room, so nothing beside it moves', () => {
    expect(sidebar).toMatch(/\.column\.shut\.floating aside \{\s*position: absolute;/)
  })
})
