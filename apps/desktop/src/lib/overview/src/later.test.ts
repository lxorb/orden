import { expect, test, vi } from 'vitest'
import { forgetLater, later, laterFirst } from './later'

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
