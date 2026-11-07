import { describe, expect, test } from 'vitest'
import { FreeScroll } from './free-scroll'

function rounded(one: { x: number; y: number }) {
  return { x: Math.round(one.x * 100) / 100, y: Math.round(one.y * 100) / 100 }
}

describe('two fingers on a touchpad the engine holds to one axis', () => {
  test('pan the way the fingers go, learning the size and the way round from the wheel', () => {
    const free = new FreeScroll()
    free.fingers(2)

    free.pan(0, 1, 10)
    expect(rounded(free.wheel({ deltaX: 0, deltaY: -12, timeStamp: 11 }))).toEqual({ x: 0, y: -12 })

    free.pan(3, 4, 20)
    expect(rounded(free.wheel({ deltaX: 0, deltaY: -48, timeStamp: 21 }))).toEqual({
      x: -36,
      y: -48,
    })

    free.pan(-2, 2, 30)
    expect(rounded(free.wheel({ deltaX: 0, deltaY: -24, timeStamp: 31 }))).toEqual({
      x: 24,
      y: -24,
    })
  })

  test('until the wheel has said enough, the wheel is followed as it is', () => {
    const free = new FreeScroll()
    free.fingers(2)
    free.pan(0.5, 0.5, 10)

    expect(free.wheel({ deltaX: 0, deltaY: 6, timeStamp: 11 })).toEqual({ x: 0, y: 6 })
  })

  test('lifted, the glide the engine sends on keeps the way the fingers went', () => {
    const free = new FreeScroll()
    free.fingers(2)
    free.pan(0, 2, 10)
    free.wheel({ deltaX: 0, deltaY: 20, timeStamp: 11 })
    free.pan(3, 4, 20)
    free.wheel({ deltaX: 0, deltaY: 40, timeStamp: 21 })
    free.fingers(0)

    expect(rounded(free.wheel({ deltaX: 0, deltaY: 8, timeStamp: 300 }))).toEqual({ x: 6, y: 8 })
    expect(rounded(free.wheel({ deltaX: 0, deltaY: 4, timeStamp: 350 }))).toEqual({ x: 3, y: 4 })
  })

  test('a glide nearly across the held axis is left as the engine sends it', () => {
    const free = new FreeScroll()
    free.fingers(2)
    free.pan(0, 2, 10)
    free.wheel({ deltaX: 0, deltaY: 20, timeStamp: 11 })
    free.pan(10, 0.5, 20)
    free.wheel({ deltaX: 0, deltaY: 5, timeStamp: 21 })
    free.fingers(0)

    expect(free.wheel({ deltaX: 0, deltaY: 3, timeStamp: 300 })).toEqual({ x: 0, y: 3 })
  })
})

describe('anything else', () => {
  test('a mouse wheel, or a touchpad that tells nothing, scrolls as the wheel says', () => {
    const free = new FreeScroll()
    expect(free.wheel({ deltaX: 0, deltaY: 100, timeStamp: 1 })).toEqual({ x: 0, y: 100 })
    expect(free.wheel({ deltaX: 40, deltaY: 0, timeStamp: 2 })).toEqual({ x: 40, y: 0 })
  })

  test('a wheel long after the fingers went is a wheel again', () => {
    const free = new FreeScroll()
    free.fingers(2)
    free.pan(0, 2, 10)
    free.wheel({ deltaX: 0, deltaY: 20, timeStamp: 11 })
    free.pan(3, 4, 20)
    free.wheel({ deltaX: 0, deltaY: 40, timeStamp: 21 })
    free.fingers(0)

    expect(free.wheel({ deltaX: 0, deltaY: 100, timeStamp: 5000 })).toEqual({ x: 0, y: 100 })
  })
})
