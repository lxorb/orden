import { describe, expect, test } from 'vitest'
import { refreshRate, SETTLE, Settling } from './view'

describe('the refresh rate', () => {
  test('is the middle gap’s, whatever a frame or two late says', () => {
    const at60 = [16.7, 16.6, 16.7, 33.4, 16.6, 16.7, 16.7, 16.6, 50, 16.7]
    expect(refreshRate(at60)).toBe(60)
    expect(refreshRate(Array.from({ length: 30 }, () => 1000 / 144))).toBe(144)
  })

  test('is not known from too few frames, or from a window whose frames are held back', () => {
    expect(refreshRate([16.7, 16.7])).toBeNull()
    expect(refreshRate(Array.from({ length: 30 }, () => 1000))).toBeNull()
    expect(refreshRate(Array.from({ length: 30 }, () => 0))).toBeNull()
  })
})

describe('a view', () => {
  test('is said once it has stayed the same a while: the last of a drag, once', () => {
    const said: number[] = []
    const timers: { run: () => void; gone: boolean; ms: number }[] = []
    const settling = new Settling<number>(
      (value) => said.push(value),
      (ms, run) => {
        const timer = { run, gone: false, ms }
        timers.push(timer)
        return () => {
          timer.gone = true
        }
      },
    )
    settling.saw(1)
    settling.saw(2)
    settling.saw(3)
    expect(timers.map((one) => one.ms)).toEqual([SETTLE, SETTLE, SETTLE])
    const due = () => {
      for (const timer of timers.splice(0)) if (!timer.gone) timer.run()
    }
    due()
    expect(said).toEqual([3])

    settling.saw(4)
    settling.end()
    due()
    expect(said).toEqual([3])
  })
})
