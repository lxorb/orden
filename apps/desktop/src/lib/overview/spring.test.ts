import { expect, test } from 'vitest'
import { FLIGHT, land, PIXELS, resting, spring, step } from './spring'

/** Runs a spring at sixty frames a second until it rests; answers how long it took and
 *  the farthest it went past where it was going. */
function settle(from: number, to: number, frames = 600) {
  const one = spring(from)
  one.to = to
  let past = 0
  for (let frame = 0; frame < frames; frame++) {
    step(one, 1 / 60)
    past = Math.max(past, (one.at - to) * Math.sign(to - from))
    if (resting(one)) return { seconds: (frame + 1) / 60, past, one }
  }
  return { seconds: Infinity, past, one }
}

test('a window comes to rest where it is sent, quickly and with the least overshoot', () => {
  const { seconds, past, one } = settle(0, 600)
  expect(one.at).toBe(600)
  expect(one.speed).toBe(0)
  expect(seconds).toBeLessThan(FLIGHT.response * 2)
  expect(past).toBeLessThan(600 * 0.02)
})

test('sent somewhere else mid-flight, it turns from where it is at the speed it had', () => {
  const one = spring(0)
  one.to = 600
  for (let frame = 0; frame < 6; frame++) step(one, 1 / 60)
  const { at, speed } = one
  expect(speed).toBeGreaterThan(0)

  one.to = 0
  step(one, 1 / 60)
  // No jump: one frame on from where it was, still carried by its speed.
  expect(Math.abs(one.at - at)).toBeLessThan(speed / 60 + 1)
  expect(one.at).toBeGreaterThan(at - 1)
})

test('a long frame does not throw it past where it is going', () => {
  const one = spring(0)
  one.to = 100
  step(one, 2)
  expect(one.at).toBeLessThanOrEqual(100 + 100 * 0.02)
})

test('landing is there at once, which reduced motion asks for', () => {
  const one = spring(0)
  one.to = 42
  land(one)
  expect(one).toMatchObject({ at: 42, speed: 0 })
  expect(resting(one)).toBe(true)
  expect(PIXELS).toBeLessThan(1)
})
