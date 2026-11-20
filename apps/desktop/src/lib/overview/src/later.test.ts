import { expect, test, vi } from 'vitest'
import { forgetLater, later, laterFirst, settled } from './later'

test('work put first runs before the work already waiting, and each step stops at the frame budget', () => {
  const frames: FrameRequestCallback[] = []
  const timers: (() => void)[] = []
  let now = 0
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
  vi.stubGlobal('setTimeout', (run: () => void) => timers.push(run))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const ran: string[] = []
  const step = (name: string) => () => {
    ran.push(name)
    now += 5
  }
  later(step('a'))
  later(step('b'))
  laterFirst(step('c'))
  const tick = () => {
    frames.splice(0).forEach((run) => run(now))
    timers.splice(0).forEach((run) => run())
  }
  tick()
  expect(ran).toEqual(['c'])
  tick()
  tick()
  expect(ran).toEqual(['c', 'a', 'b'])
  forgetLater()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
test('settled waits until every waiting piece of work has run, however many steps that takes', async () => {
  const frames: FrameRequestCallback[] = []
  const timers: (() => void)[] = []
  let now = 0
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
  vi.stubGlobal('setTimeout', (run: () => void) => timers.push(run))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const ran: number[] = []
  for (let one = 0; one < 5; one++)
    later(() => {
      ran.push(one)
      now += 5
    })
  const calm = { now: false }
  void settled().then(() => (calm.now = true))
  let steps = 0
  while (!calm.now) {
    frames.splice(0).forEach((run) => run(now))
    timers.splice(0).forEach((run) => run())
    await Promise.resolve()
    steps++
  }
  expect(ran).toEqual([0, 1, 2, 3, 4])
  expect(steps).toBe(5)
  await settled()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
