import { describe, expect, test } from 'vitest'
import { LEAD, Slid } from './slid'

function scroller() {
  const held = { scrollLeft: 0 }
  return { one: held as unknown as Element, to: (left: number) => (held.scrollLeft = left) }
}

describe('whether a stream moved the content sideways (#407)', () => {
  test('a scroller that moved sideways moves its pane, from a moment before the stream on', () => {
    const slid = new Slid()
    const { one, to } = scroller()
    to(18)
    slid.heard(one, 'p1', 1000)

    expect(slid.since('p1', 1000)).toBe(true)
    expect(slid.since('p1', 1000 + LEAD)).toBe(true)
    expect(slid.since('p1', 1000 + LEAD + 1)).toBe(false)
    expect(slid.since('p2', 1000)).toBe(false)
  })

  test('a scroll straight down moves nothing sideways', () => {
    const slid = new Slid()
    const { one } = scroller()
    slid.heard(one, 'p1', 1000)
    expect(slid.since('p1', 1000)).toBe(false)
  })

  test('each scroll is measured from where the scroller last stood', () => {
    const slid = new Slid()
    const { one, to } = scroller()
    to(40)
    slid.heard(one, 'p1', 1000)
    slid.heard(one, 'p1', 2000)
    expect(slid.since('p1', 2000)).toBe(false)
    to(40.3)
    slid.heard(one, 'p1', 3000)
    expect(slid.since('p1', 3000)).toBe(false)
    to(0)
    slid.heard(one, 'p1', 4000)
    expect(slid.since('p1', 4000)).toBe(true)
  })

  test('a scroll in no pane is nobody s, and forgetting forgets', () => {
    const slid = new Slid()
    const { one, to } = scroller()
    to(30)
    slid.heard(one, null, 1000)
    expect(slid.since('p1', 1000)).toBe(false)
    to(0)
    slid.heard(one, 'p1', 2000)
    slid.forget()
    expect(slid.since('p1', 2000)).toBe(false)
  })
})
