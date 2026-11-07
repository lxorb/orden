// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { hang, inSight, placeOf } from './portal'

const at = { left: 100, top: 100, right: 300, bottom: 120 }
const size = { width: 150, height: 40 }
const room = { width: 1000, height: 800 }
const below = { side: 'below', gap: 6, inset: -3 } as const

describe('where a bubble goes', () => {
  test('under the element, its start edge in from the element’s', () => {
    expect(placeOf(at, size, room, below, false)).toEqual({ left: 97, top: 126, side: 'below' })
  })

  test('from the right under an interface that reads right to left', () => {
    expect(placeOf(at, size, room, below, true).left).toBe(300 + 3 - 150)
  })

  test('over the element where it is asked to be', () => {
    expect(placeOf(at, size, room, { ...below, side: 'above' }, false)).toEqual({
      left: 97,
      top: 100 - 6 - 40,
      side: 'above',
    })
  })

  test('turned over to the other side where there is no room on its own', () => {
    const low = { left: 100, top: 770, right: 300, bottom: 790 }
    expect(placeOf(low, size, room, below, false)).toEqual({ left: 97, top: 724, side: 'above' })
    const high = { left: 100, top: 10, right: 300, bottom: 30 }
    expect(placeOf(high, size, room, { ...below, side: 'above' }, false).side).toBe('below')
  })

  test('kept inside the window', () => {
    const edge = { left: 940, top: 100, right: 990, bottom: 120 }
    expect(placeOf(edge, size, room, below, false).left).toBe(1000 - 8 - 150)
    const start = { left: 2, top: 100, right: 40, bottom: 120 }
    expect(placeOf(start, size, room, below, false).left).toBe(8)
  })
})

describe('whether the element is in sight', () => {
  test('while any of it is left inside every box that clips it', () => {
    expect(inSight(at, [{ left: 0, top: 0, right: 500, bottom: 110 }])).toBe(true)
    expect(inSight(at, [{ left: 0, top: 0, right: 500, bottom: 90 }])).toBe(false)
    const joiner = { left: 200, top: 100, right: 200, bottom: 120 }
    expect(inSight(joiner, [{ left: 0, top: 0, right: 500, bottom: 500 }])).toBe(true)
    expect(inSight(at, [])).toBe(true)
  })
})

describe('the action', () => {
  afterEach(() => document.body.replaceChildren())

  function holder() {
    const layer = document.createElement('div')
    layer.style.position = 'fixed'
    const row = document.createElement('div')
    row.style.overflow = 'hidden'
    const label = document.createElement('span')
    label.style.position = 'relative'
    const bubble = document.createElement('span')
    bubble.className = 'orden-bubble'
    label.append(bubble)
    row.append(label)
    layer.append(row)
    document.body.append(layer)
    return { row, label, bubble }
  }

  test('takes the bubble out of every holder, onto the window', () => {
    const { row, bubble } = holder()
    const hung = hang(bubble, below)
    expect(bubble.parentElement).toBe(document.body)
    expect(row.contains(bubble)).toBe(false)
    expect(bubble.style.position).toBe('fixed')
    hung.destroy?.()
    expect(bubble.isConnected).toBe(false)
  })
})
