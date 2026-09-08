import { describe, expect, test, vi } from 'vitest'
import { claimsGesture, scrollsSideways, settleOpen } from './swipe'

const WIDTH = 300

// The walk reads two numbers and one declared value off each box it passes.
vi.stubGlobal('getComputedStyle', (node: { overflowX: string }) => ({ overflowX: node.overflowX }))

/** A box the walk can read. Cast because only the four members it looks at are
 *  worth writing, and a whole Element would say nothing more. */
function box(overflowX: string, scrollWidth: number, clientWidth = 320): Element {
  return { overflowX, scrollWidth, clientWidth, parentElement: null } as unknown as Element
}

/** Puts each box inside the one before it, and answers the innermost, which is
 *  where a finger lands. */
function nest(outermost: Element, ...inside: Element[]): Element {
  let around = outermost
  for (const one of inside) {
    Object.assign(one, { parentElement: around })
    around = one
  }

  return around
}

/** Somewhere above everything, which is where the walk stops. */
const host = box('visible', 320)

describe('what scrolls sideways under the finger', () => {
  test('a table wider than its box, which is a box that scrolls', () => {
    expect(scrollsSideways(nest(host, box('auto', 900)), host)).toBe(true)
  })

  test('a cell inside one: the walk goes up to find it', () => {
    const cell = nest(host, box('auto', 900), box('visible', 120, 120))
    expect(scrollsSideways(cell, host)).toBe(true)
  })

  test('not the writing surface, which is wider than its box but clips', () => {
    expect(scrollsSideways(nest(host, box('hidden', 900)), host)).toBe(false)
  })

  test('not a box that scrolls but has nothing to scroll to', () => {
    expect(scrollsSideways(nest(host, box('auto', 320)), host)).toBe(false)
  })

  test('nothing above the element the gesture belongs to is looked at', () => {
    const above = box('auto', 900)
    const stop = box('visible', 320)
    const line = nest(above, stop, box('visible', 320))
    expect(scrollsSideways(line, stop)).toBe(false)
  })

  test('a touch on nothing is not a touch on a scroller', () => {
    expect(scrollsSideways(null, host)).toBe(false)
  })
})

describe('claiming a swipe', () => {
  test('ignores a movement too small to mean anything', () => {
    expect(claimsGesture(4, 1)).toBe(false)
  })

  test('ignores a scroll, however far it goes', () => {
    expect(claimsGesture(6, 90)).toBe(false)
  })

  test('takes a clearly sideways drag', () => {
    expect(claimsGesture(40, 8)).toBe(true)
  })

  test('takes one going the other way, which is how it closes', () => {
    expect(claimsGesture(-40, 8)).toBe(true)
  })

  test('leaves a diagonal to the scroller', () => {
    expect(claimsGesture(30, 40)).toBe(false)
  })
})

describe('where the drawer lands when the finger lifts', () => {
  test('opens once it is dragged past halfway', () => {
    expect(settleOpen(WIDTH / 2 + 1, WIDTH, 0)).toBe(true)
  })

  test('falls back when it is not', () => {
    expect(settleOpen(WIDTH / 2 - 1, WIDTH, 0)).toBe(false)
  })

  test('a flick opens it from barely anywhere', () => {
    // The whole point: a short fast swipe should not need to cross the middle.
    expect(settleOpen(30, WIDTH, 1.2)).toBe(true)
  })

  test('a flick back closes it from almost fully open', () => {
    expect(settleOpen(WIDTH - 20, WIDTH, -1.2)).toBe(false)
  })

  test('a slow drag past halfway still opens, flick or no flick', () => {
    expect(settleOpen(WIDTH - 10, WIDTH, -0.05)).toBe(true)
  })

  test('nothing dragged and nothing thrown stays shut', () => {
    expect(settleOpen(0, WIDTH, 0)).toBe(false)
  })
})
