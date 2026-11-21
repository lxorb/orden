import { expect, test } from 'vitest'
import { land, resting, spring, step } from '../src/api'

test('a spring comes to rest where it was sent and lands at once when asked', () => {
  const one = spring(0)
  one.to = 100
  for (let frame = 0; frame < 600 && !resting(one); frame += 1) step(one, 1 / 60)
  expect(one.at).toBe(100)
  expect(one.speed).toBe(0)
  one.to = 40
  land(one)
  expect(one.at).toBe(40)
})
