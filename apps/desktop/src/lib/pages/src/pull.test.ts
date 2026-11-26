import { describe, expect, test } from 'vitest'
import {
  began,
  dragged,
  FALL,
  full,
  LEAST_REACH,
  lifted,
  MOST_REACH,
  noPull,
  reachFor,
  riseOf,
  SETTLE,
  startedNearEnd,
  wheeled,
} from './pull'

const atEnd = (now = 1000) => began(noPull(), true, now)
describe('how far the pull has to come', () => {
  test('is a third of the page on screen, between a floor and a ceiling', () => {
    expect(reachFor(360)).toBe(120)
    expect(reachFor(60)).toBe(LEAST_REACH)
    expect(reachFor(99999)).toBe(MOST_REACH)
  })
})
describe('where a pull may begin', () => {
  test('in the lower half of the last page, never above it or with no pages', () => {
    expect(startedNearEnd(950, { y: 0, height: 1000 })).toBe(true)
    expect(startedNearEnd(400, { y: 0, height: 1000 })).toBe(false)
    expect(startedNearEnd(950, null)).toBe(false)
  })
  test('and not again until the quiet after a page is over', () => {
    const made = lifted(dragged(atEnd(), { raw: 200, now: 1100 }), { reach: 120, now: 1200 }).pull
    expect(began(made, true, 1200 + SETTLE / 2).allowed).toBe(false)
    expect(began(made, true, 1200 + SETTLE).allowed).toBe(true)
  })
})
describe('the slot fills with the hand', () => {
  test('pixel for pixel while held', () => {
    for (const raw of [1, 30, 60, 119]) expect(riseOf(dragged(atEnd(), { raw, now: 1010 }), 120, 1010)).toBe(raw)
  })
  test('up to full and no further', () => {
    expect(riseOf(dragged(atEnd(), { raw: 500, now: 1010 }), 120, 1010)).toBe(120)
  })
  test('and stays where it is for as long as it is held', () => {
    const held = dragged(atEnd(), { raw: 70, now: 1010 })
    expect(riseOf(held, 120, 1010 + 10 * FALL)).toBe(70)
  })
  test('the same for a wheel or a trackpad, whose deltas add up and give back', () => {
    let pull = atEnd()
    for (const delta of [20, 20, 20]) pull = wheeled(pull, { delta, now: 1010 })
    expect(riseOf(pull, 120, 1010)).toBe(60)
    pull = wheeled(pull, { delta: -45, now: 1020 })
    expect(riseOf(pull, 120, 1020)).toBe(15)
    pull = wheeled(pull, { delta: -90, now: 1030 })
    expect(riseOf(pull, 120, 1030)).toBe(0)
  })
  test('and does nothing where the gesture began away from the end', () => {
    const far = began(noPull(), false, 1000)
    expect(riseOf(dragged(far, { raw: 300, now: 1010 }), 120, 1010)).toBe(0)
    expect(riseOf(wheeled(far, { delta: 300, now: 1010 }), 120, 1010)).toBe(0)
  })
})
describe('letting go', () => {
  test('when full adds a page', () => {
    const pull = dragged(atEnd(), { raw: 120, now: 1010 })
    expect(full(pull, 120)).toBe(true)
    expect(lifted(pull, { reach: 120, now: 1020 }).makes).toBe(true)
  })
  test('short of full adds nothing and eases back to nothing within the fall', () => {
    const answer = lifted(dragged(atEnd(), { raw: 119, now: 1010 }), { reach: 120, now: 1020 })
    expect(answer.makes).toBe(false)
    const seen = [0, FALL / 4, FALL / 2, (3 * FALL) / 4, FALL].map((after) => riseOf(answer.pull, 120, 1020 + after))
    expect(seen[0]).toBe(119)
    for (const [at, one] of seen.entries()) if (at > 0) expect(one).toBeLessThan(seen[at - 1] ?? 0)
    expect(seen.at(-1)).toBe(0)
  })
  test('and goes back at once for a reader who asked for no movement', () => {
    const answer = lifted(dragged(atEnd(), { raw: 80, now: 1010 }), { reach: 120, now: 1020 })
    expect(riseOf(answer.pull, 120, 1020, true)).toBe(0)
  })
  test('of nothing being pulled makes nothing', () => {
    expect(lifted(noPull(), { reach: 120, now: 1000 }).makes).toBe(false)
  })
})
describe('speed alone never adds a page', () => {
  test('a wheel only fills; the page comes when it is let go full', () => {
    let pull = atEnd()
    for (let at = 0; at < 40; at++) pull = wheeled(pull, { delta: 200, now: 1000 + at * 8 })
    expect(full(pull, 120)).toBe(true)
    expect(riseOf(pull, 120, 1400)).toBe(120)
  })
  test('a fling that reaches the end from above never fills, however long it runs on', () => {
    let pull = began(noPull(), false, 1000)
    for (let at = 0; at < 120; at++) pull = wheeled(pull, { delta: 400, now: 1000 + at * 16 })
    expect(pull.raw).toBe(0)
    expect(lifted(pull, { reach: 120, now: 3000 }).makes).toBe(false)
  })
})
