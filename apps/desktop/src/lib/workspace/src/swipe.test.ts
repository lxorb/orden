import { describe, expect, test, vi } from 'vitest'
import { claimsGesture, isFinger } from './drawer.svelte'
import { fromEdge, opensDrawer, ownsEveryTouch, ownsGesture, settleOpen } from './swipe'

const WIDTH = 300

vi.stubGlobal('getComputedStyle', (node: { overflowX: string; touchAction: string }) => ({
  overflowX: node.overflowX,
  touchAction: node.touchAction,
}))

const SCREEN = 1280
vi.stubGlobal('window', { innerWidth: SCREEN })

function box(overflowX: string, scrollWidth: number, clientWidth = 320, touchAction = 'auto') {
  return {
    overflowX,
    scrollWidth,
    clientWidth,
    touchAction,
    parentElement: null,
    hasAttribute: () => false,
  } as unknown as Element
}

function drawing(): Element {
  return box('hidden', 320, 320, 'none')
}

function nest(outermost: Element, ...inside: Element[]): Element {
  let around = outermost
  for (const one of inside) {
    Object.assign(one, { parentElement: around })
    around = one
  }

  return around
}

const host = box('visible', 320)

describe('what owns the gesture under the finger', () => {
  test('a table wider than its box, which is a box that scrolls', () => {
    expect(ownsGesture(nest(host, box('auto', 900)), host)).toBe(true)
  })

  test('a cell inside one: the walk goes up to find it', () => {
    const cell = nest(host, box('auto', 900), box('visible', 120, 120))
    expect(ownsGesture(cell, host)).toBe(true)
  })

  test('not the writing surface, which is wider than its box but clips', () => {
    expect(ownsGesture(nest(host, box('hidden', 900)), host)).toBe(false)
  })

  test('not a box that scrolls but has nothing to scroll to', () => {
    expect(ownsGesture(nest(host, box('auto', 320)), host)).toBe(false)
  })

  test('a canvas, which has said it takes every touch on it', () => {
    expect(ownsGesture(nest(host, drawing()), host)).toBe(true)
  })

  test('and the ink layer inside one, wherever the stroke landed', () => {
    expect(ownsGesture(nest(host, drawing(), box('visible', 320)), host)).toBe(true)
  })

  test("a phone's board, which turns its columns on a sideways swipe", () => {
    const board = Object.assign(box('visible', 320), { hasAttribute: () => true })
    expect(ownsGesture(nest(host, board, box('visible', 320)), host)).toBe(true)
  })

  test('but not in a drawer’s edge strip, where the drawer goes first, as Google Docs’ does', () => {
    const board = Object.assign(box('visible', 320), { hasAttribute: () => true })
    expect(ownsGesture(nest(host, board, box('visible', 320)), host, true)).toBe(false)
    expect(ownsGesture(nest(host, box('auto', 900)), host, true)).toBe(true)
  })

  test('not the note, which leaves the sideways drag to whoever wants it', () => {
    const note = box('hidden', 320, 320, 'pan-y pinch-zoom')
    expect(ownsGesture(nest(host, note), host)).toBe(false)
  })

  test('nothing above the element the gesture belongs to is looked at', () => {
    const above = box('auto', 900)
    const stop = box('visible', 320)
    const line = nest(above, stop, box('visible', 320))
    expect(ownsGesture(line, stop)).toBe(false)
  })

  test('a touch on nothing is not a touch on a scroller', () => {
    expect(ownsGesture(null, host)).toBe(false)
  })
})

describe('what a touch-action value says', () => {
  test.each([
    ['none', true],
    ['pinch-zoom', true],
    ['auto', false],
    ['manipulation', false],
    ['pan-y pinch-zoom', false],
    ['pan-x', false],
  ])('%s takes every touch: %s', (value, owns) => {
    expect(ownsEveryTouch(value)).toBe(owns)
  })
})

describe('whose hand is on the screen', () => {
  test.each([
    ['touch', true],
    ['pen', false],
    ['mouse', true],
    ['', true],
  ])('%s drags the drawer: %s', (kind, finger) => {
    expect(isFinger(kind)).toBe(finger)
  })
})

describe('where a drag may start', () => {
  test.each([
    [8, false, true],
    [32, false, true],
    [400, false, false],
    [400, true, true],
    [8, true, true],
  ])('at %i on a phone %s opens the drawer: %s', (x, phone, opens) => {
    expect(opensDrawer(x, 32, phone)).toBe(opens)
  })
})

describe('how far a touch is from a drawer’s own edge', () => {
  test('the near drawer counts from the left, the far one from the right', () => {
    expect(fromEdge(40, 1)).toBe(40)
    expect(fromEdge(40, -1)).toBe(SCREEN - 40)
  })

  test('so one edge rule covers both sides of a tablet', () => {
    expect(opensDrawer(fromEdge(SCREEN - 8, -1), 32, false)).toBe(true)
    expect(opensDrawer(fromEdge(SCREEN / 2, -1), 32, false)).toBe(false)
  })
})

describe('claiming a swipe', () => {
  test.each([
    ['a movement too small to mean anything', 4, 1, false],
    ['a scroll, however far it goes', 6, 90, false],
    ['a clearly sideways drag', 40, 8, true],
    ['one going the other way, which is how it closes', -40, 8, true],
    ['a diagonal', 30, 40, false],
  ])('%s: %s', (_name, x, y, claims) => {
    expect(claimsGesture(x, y)).toBe(claims)
  })
})

describe('where the drawer lands when the finger lifts', () => {
  test.each([
    ['dragged past halfway', WIDTH / 2 + 1, 0, true],
    ['short of halfway', WIDTH / 2 - 1, 0, false],
    ['a flick from barely anywhere', 30, 1.2, true],
    ['a flick back from almost fully open', WIDTH - 20, -1.2, false],
    ['a slow drag past halfway', WIDTH - 10, -0.05, true],
    ['nothing dragged and nothing thrown', 0, 0, false],
  ])('%s', (_name, at, speed, open) => {
    expect(settleOpen(at, WIDTH, speed)).toBe(open)
  })
})
