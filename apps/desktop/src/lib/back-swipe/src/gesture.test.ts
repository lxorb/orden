import { describe, expect, test } from 'vitest'
import {
  BACKING,
  coasting,
  distance,
  FLING,
  MOST,
  QUIET,
  RATIO,
  type Side,
  type Source,
  START,
  Swipe,
  type Turn,
} from './gesture'

const ROOM = { width: 800, height: 600 }
const PAD = distance('touchpad', ROOM.width, ROOM.height)

const EDGE: Record<Side, boolean> = { left: false, right: false }
const BOTH: Record<Side, boolean> = { left: true, right: true }

function stream(
  swipe: Swipe,
  steps: readonly (readonly [number, number])[],
  extra: Partial<Pick<Turn, 'scrolls' | 'goes'>> = {},
  from = 1000,
) {
  let at = from
  let shown = swipe.shown
  for (const [dx, dy] of steps) {
    at += 8
    shown = swipe.turn({ dx, dy, at, scrolls: EDGE, goes: BOTH, ...extra })
  }
  return { shown, at }
}

const swipe = (source: Source = 'touchpad') => new Swipe(source, () => ROOM)
const told = () => new Swipe('touchpad', () => ROOM, true)
const times = (count: number, step: readonly [number, number]) =>
  Array.from({ length: count }, () => step)

describe('the start', () => {
  test('is no swipe until the stream has gone the start sideways', () => {
    const one = swipe()
    const { shown } = stream(one, times(6, [-10, 0]))
    expect(shown.phase).toBe('gathering')

    expect(stream(one, [[-10, 0]], {}, 2000).shown.phase).toBe('tracking')
  })

  test('but the arrow is out from the first step that leans sideways', () => {
    const one = swipe()
    expect(stream(one, [[-3, 0]]).shown).toMatchObject({ phase: 'gathering', travel: 3 })
    expect(one.shown.progress).toBeGreaterThan(0)
    expect(stream(one, [[-4, 1]], {}, 2000).shown.travel).toBe(7)
  })

  test('and not for a step that leans down, nor towards nowhere to go', () => {
    expect(stream(swipe(), [[-3, 4]]).shown.travel).toBe(0)
    const none = stream(swipe(), [[-3, 0]], { goes: { left: false, right: true } })
    expect(none.shown.travel).toBe(0)
  })

  test('the side is the one the scroll pushes against', () => {
    expect(stream(swipe(), times(8, [-10, 0])).shown.side).toBe('left')
    expect(stream(swipe(), times(8, [10, 0])).shown.side).toBe('right')
  })

  test('a stream that goes down first is a scroll, to its end', () => {
    const one = swipe()
    expect(stream(one, times(8, [0, 10])).shown.phase).toBe('content')
    expect(stream(one, times(40, [-20, 0]), {}, 2000).shown.phase).toBe('content')
  })

  test('sideways has to beat down by the ratio', () => {
    const one = swipe()
    expect(stream(one, times(7, [-10, 5])).shown.phase).toBe('gathering')
    expect(RATIO).toBe(2.5)
  })

  test('nowhere to go is no arrow, and the stream stays nobody s', () => {
    const one = swipe()
    const shown = stream(one, times(40, [-10, 0]), { goes: { left: false, right: true } }).shown
    expect(shown.phase).toBe('stayed')
    expect(shown.progress).toBe(0)
  })
})

describe('the content first', () => {
  test('a scroll the content can take is the content s, to the stream s end', () => {
    const one = swipe()
    expect(
      stream(one, times(3, [-10, 0]), { scrolls: { left: true, right: false } }).shown.phase,
    ).toBe('content')
    expect(stream(one, times(40, [-20, 0]), {}, 2000).shown.phase).toBe('content')
    expect(one.lift(3000).phase).toBe('idle')

    expect(stream(one, times(10, [-10, 0]), {}, 4000).shown.phase).toBe('tracking')
  })

  test('the content scrolling the other way leaves this way free', () => {
    const one = swipe()
    expect(
      stream(one, times(10, [-10, 0]), { scrolls: { left: false, right: true } }).shown.phase,
    ).toBe('tracking')
  })
})

describe('letting go', () => {
  test('far enough along goes', () => {
    const one = swipe()
    const { at } = stream(one, times(40, [-10, 0]))
    expect(one.shown.progress).toBeGreaterThanOrEqual(1)
    expect(one.lift(at + QUIET).phase).toBe('went')
  })

  test('short of it stays', () => {
    const one = swipe()
    const { at } = stream(one, times(20, [-10, 0]))
    expect(one.shown.progress).toBeLessThan(1)
    expect(one.lift(at + QUIET).phase).toBe('stayed')
  })

  test('brought back stays, and the arrow never goes past where it started', () => {
    const one = swipe()
    stream(one, times(40, [-10, 0]))
    const { shown, at } = stream(one, times(60, [10, 0]), {}, 2000)
    expect(shown.progress).toBe(0)
    expect(one.lift(at + QUIET).phase).toBe('stayed')
  })

  test('a fling towards the arrow goes whatever the distance', () => {
    const one = swipe('touch')
    const { shown, at } = stream(one, times(8, [-9, 0]))
    expect(shown.progress).toBeLessThan(1)
    expect(9 / 8).toBeGreaterThan(FLING)
    expect(one.lift(at).phase).toBe('went')
  })

  test('held still before letting go is no fling', () => {
    const one = swipe('touch')
    const { at } = stream(one, times(8, [-9, 0]))
    expect(one.lift(at + QUIET).phase).toBe('stayed')
  })

  test('a lift ends the stream, and the next step starts a new one', () => {
    const one = swipe()
    const { at } = stream(one, times(40, [-10, 0]))
    one.lift(at + QUIET)
    expect(one.shown.phase).toBe('idle')
    expect(stream(one, [[-10, 0]], {}, at + 1000).shown.phase).toBe('gathering')
  })
})

describe('the touchpad coasting', () => {
  const flick = (hand: number): (readonly [number, number])[] => [
    ...times(hand, [-16, 0] as const),
    ...Array.from({ length: 6 }, (_, at): [number, number] => [-16 * 0.85 ** (at + 1), 0]),
  ]

  test('decides as soon as the steps shrink steadily, and swallows the rest', () => {
    const one = swipe()
    const { shown, at } = stream(one, flick(8))
    expect(shown.phase).toBe('went')
    expect(stream(one, times(10, [-3, 0]), {}, at).shown.phase).toBe('went')
    expect(one.lift(at + 200).phase).toBe('idle')
  })

  test('a slow coast short of the distance stays, decided at once', () => {
    const one = swipe()
    const slow: (readonly [number, number])[] = [
      ...times(8, [-9, 0] as const),
      ...Array.from({ length: 5 }, (_, at): [number, number] => [-3 * 0.6 ** at, 0]),
    ]
    const { shown, at } = stream(one, slow)
    expect(shown.phase).toBe('stayed')
    expect(one.lift(at + QUIET).phase).toBe('idle')
  })

  test('a finger on a screen slowing down is still on it', () => {
    const one = swipe('touch')
    expect(stream(one, flick(4)).shown.phase).toBe('tracking')
  })

  test('a coast is a steady share, starting fast', () => {
    const steps = (speeds: number[]) => speeds.map((one) => ({ along: one * 8, gap: 8 }))
    expect(coasting(steps([2, 1.7, 1.45, 1.23]))).not.toBeNull()
    expect(coasting(steps([2, 1.7, 1.9, 1.6]))).toBeNull()
    expect(coasting(steps([0.2, 0.17, 0.145, 0.123]))).toBeNull()
    expect(coasting(steps([2, 1.7, 1.45]))).toBeNull()

    const said = coasting(steps([2, 1.2, 0.72, 0.432]))
    expect(said?.from).toBe(2)
    expect(said?.left).toBeCloseTo(0.432 * 8 * 1.5)
  })
})

test('the distance is Chrome s share of the longer side, less the start, never tiny', () => {
  expect(distance('touchpad', 800, 600)).toBe(800 * 0.3 - START.touchpad)
  expect(distance('touch', 800, 600)).toBe(800 * 0.25 - START.touch)
  expect(distance('touchpad', 200, 150)).toBe(80)
  expect(PAD).toBe(180)
})

test('a wide window never asks for more of the pad than the most', () => {
  expect(distance('touchpad', 1920, 1080)).toBe(MOST)
  expect(distance('touch', 2560, 1440)).toBe(MOST)
  expect(MOST).toBeLessThan(1920 * 0.3 - START.touchpad)

  const wide = new Swipe('touchpad', () => ({ width: 1920, height: 1080 }))
  const { at } = stream(wide, times(39, [-10, 0]))
  expect(wide.shown.progress).toBeGreaterThanOrEqual(1)
  expect(wide.lift(at + QUIET).phase).toBe('went')
})

test('the content is asked only until the stream has said whose it is', () => {
  const one = swipe()
  expect(one.asking).toBe(true)
  stream(one, times(3, [-10, 0]))
  expect(one.asking).toBe(true)
  stream(one, times(5, [-10, 0]), {}, 2000)
  expect(one.shown.phase).toBe('tracking')
  expect(one.asking).toBe(false)

  const down = swipe()
  stream(down, times(8, [0, 10]))
  expect(down.asking).toBe(false)
})

describe('a touchpad that says when the fingers lift', () => {
  test('held still past the distance is armed, for as long as the hand likes, and goes on the lift', () => {
    const one = told()
    const { shown, at } = stream(one, times(40, [-10, 0]))
    expect(shown.phase).toBe('tracking')
    expect(shown.progress).toBeGreaterThanOrEqual(1)
    expect(one.shown.phase).toBe('tracking')
    expect(one.lift(at + 5000).phase).toBe('went')
  })

  test('slowing down to a stop is never read as a coast', () => {
    const one = told()
    const slowing: (readonly [number, number])[] = [
      ...times(14, [-16, 0] as const),
      ...Array.from({ length: 8 }, (_, at): [number, number] => [-16 * 0.85 ** (at + 1), 0]),
    ]
    expect(stream(swipe(), slowing).shown.phase).toBe('went')
    const { shown, at } = stream(one, slowing)
    expect(shown.phase).toBe('tracking')
    expect(one.lift(at + 200).phase).toBe('went')
  })

  test('past the distance and brought back short of it before the lift stays', () => {
    const one = told()
    stream(one, times(30, [-10, 0]))
    expect(one.shown.progress).toBeGreaterThanOrEqual(1)
    const { at } = stream(one, times(15, [10, 0]), {}, 2000)
    expect(one.shown.progress).toBeLessThan(1)
    expect(one.lift(at + 200).phase).toBe('stayed')
  })

  test('flicked back the way it came at the lift stays, however far it had come', () => {
    const one = told()
    stream(one, times(40, [-10, 0]))
    const { at, shown } = stream(one, times(6, [10, 0]), {}, 2000)
    expect(shown.progress).toBeGreaterThanOrEqual(1)
    expect(10 / 8).toBeGreaterThan(BACKING)
    expect(one.lift(at + 8).phase).toBe('stayed')
  })

  test('a fling towards the arrow goes at the lift, short of the distance', () => {
    const one = told()
    const { at, shown } = stream(one, times(10, [-12, 0]))
    expect(shown.progress).toBeLessThan(1)
    expect(shown.phase).toBe('tracking')
    expect(one.lift(at + 8).phase).toBe('went')
  })

  test('the same sweep held still before the lift is no fling', () => {
    const one = told()
    const { at } = stream(one, times(10, [-12, 0]))
    expect(one.lift(at + 200).phase).toBe('stayed')
  })

  test('the arrow is where the fingers are, pixel for pixel, back to the side', () => {
    const one = told()
    expect(stream(one, times(10, [-10, 0])).shown.travel).toBe(100)
    expect(stream(one, times(5, [4, 0]), {}, 2000).shown.travel).toBe(80)
    expect(stream(one, times(30, [4, 0]), {}, 3000).shown.travel).toBe(0)
    expect(stream(one, times(5, [-4, 0]), {}, 4000).shown.travel).toBe(20)
  })

  test('is full exactly where letting go goes', () => {
    const one = told()
    const past = distance('touchpad', 800, 600) + START.touchpad
    const { at } = stream(one, times(past / 10, [-10, 0]))
    expect(one.shown.progress).toBe(1)
    expect(one.lift(at + QUIET).phase).toBe('went')
    const short = told()
    const end = stream(short, times(past / 10 - 1, [-10, 0])).at
    expect(short.shown.progress).toBeLessThan(1)
    expect(short.lift(end + QUIET).phase).toBe('stayed')
  })

  test('a scroll down that turns sideways in the same gesture stays a scroll', () => {
    const one = told()
    stream(one, times(10, [0, 12]))
    const { shown, at } = stream(one, times(60, [-15, 0]), {}, 2000)
    expect(shown.phase).toBe('content')
    expect(one.lift(at + 8).phase).toBe('idle')
  })
})
