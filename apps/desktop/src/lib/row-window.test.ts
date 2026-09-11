import { describe, expect, test } from 'vitest'
import {
  autoScrollBy,
  heightOf,
  indexAt,
  listHeight,
  offsetOf,
  type Rows,
  windowFor,
} from './row-window'

/** A desktop row, and a panel twenty of them tall. Counted rather than timed: what
 *  a window is right or wrong about is how many rows exist and which, and both are
 *  numbers a test can state. */
const HEIGHT = 28
const ROOM = 20 * HEIGHT

const rows = (over: Partial<Rows> = {}): Rows => ({
  count: 3000,
  height: HEIGHT,
  top: 0,
  room: ROOM,
  overscan: 0,
  ...over,
})

/** How many rows a window puts in the page: the slice, less the part of a sliding
 *  band that is flat, plus the rows it is holding on to outside it. */
const mounted = (over: Partial<Rows> = {}): number => {
  const view = windowFor(rows(over))
  const flat = view.skip === null ? 0 : view.skip.to - view.skip.from + 1

  return view.last - view.first + 1 - flat + view.pinned.length
}

describe('the window over a long list', () => {
  test('mounts the rows in view and no others', () => {
    expect(mounted()).toBe(20)
    expect(windowFor(rows())).toMatchObject({ first: 0, last: 19 })
  })

  /** The whole point: three thousand notes, twenty rows and a few either side.
   *  At the top of the list there is nothing above to keep, so it is twenty-three. */
  test('so a space of three thousand notes is twenty-six buttons', () => {
    expect(mounted({ overscan: 3, top: 40 * HEIGHT })).toBe(26)
    expect(mounted({ overscan: 3 })).toBe(23)
  })

  test('and the height the rest of them would have taken stands above and below', () => {
    const view = windowFor(rows({ top: 10 * HEIGHT }))

    expect(view.above).toBe(10 * HEIGHT)
    expect(view.above + (view.last - view.first + 1) * HEIGHT + view.below).toBe(3000 * HEIGHT)
  })

  test('moves with the scroll, a row at a time', () => {
    expect(windowFor(rows({ top: 10 * HEIGHT }))).toMatchObject({ first: 10, last: 29 })
    expect(windowFor(rows({ top: 10 * HEIGHT + 1 }))).toMatchObject({ first: 10, last: 30 })
  })

  /** A scroll that lands exactly on a row's top edge shows twenty rows, not
   *  twenty-one: the row after the last is not in view by a pixel. */
  test('and takes no row it does not need', () => {
    expect(mounted({ top: 5 * HEIGHT })).toBe(20)
  })

  test('keeps a few rows beyond either edge, so a wheel click lands on rows', () => {
    expect(windowFor(rows({ top: 40 * HEIGHT, overscan: 6 }))).toMatchObject({
      first: 34,
      last: 65,
    })
  })

  test('and asks for none that are not there, at either end', () => {
    expect(windowFor(rows({ top: 0, overscan: 6 }))).toMatchObject({ first: 0, last: 25 })
    expect(windowFor(rows({ top: 2980 * HEIGHT, overscan: 6 }))).toMatchObject({
      first: 2974,
      last: 2999,
    })
  })

  test('and holds nothing at all for a space with nothing in it', () => {
    expect(windowFor(rows({ count: 0 }))).toEqual({
      first: 0,
      last: -1,
      skip: null,
      above: 0,
      below: 0,
      pinned: [],
    })
  })

  /** The list may sit below the bookmarks, in which case the scroller has not
   *  reached it yet and `top` is negative. */
  test('starts at the first row while there is still something above the list', () => {
    expect(windowFor(rows({ top: -120 }))).toMatchObject({ first: 0, above: 0 })
  })
})

/** Ten rows of ten pixels, three of which a twist is letting out under row 2. The
 *  numbers are small so the arithmetic can be read rather than trusted. */
const folding = (grown: number): Rows => ({
  count: 10,
  height: 10,
  top: 0,
  room: 100,
  overscan: 0,
  fold: { at: 2, rows: 3, grown },
})

describe('a twist sliding what it holds into place', () => {
  test('starts with the band flat and everything under it still up', () => {
    const shut = folding(0)

    expect([0, 1, 2].map((one) => offsetOf(one, shut))).toEqual([0, 10, 20])
    expect([3, 4, 5].map((one) => offsetOf(one, shut))).toEqual([30, 30, 30])
    expect([3, 4, 5].map((one) => heightOf(one, shut))).toEqual([0, 0, 0])
    expect(offsetOf(6, shut)).toBe(30)
    expect(listHeight(shut)).toBe(70)
  })

  test('half way out, one row and a half of the band is showing', () => {
    const half = folding(1.5)

    expect([3, 4, 5].map((one) => heightOf(one, half))).toEqual([10, 5, 0])
    expect([3, 4, 5].map((one) => offsetOf(one, half))).toEqual([30, 40, 45])
    expect(offsetOf(6, half)).toBe(45)
    expect(listHeight(half)).toBe(85)
  })

  test('and once it is out the list is the list again', () => {
    const out = folding(3)

    expect([3, 4, 5, 6].map((one) => offsetOf(one, out))).toEqual([30, 40, 50, 60])
    expect([3, 4, 5].map((one) => heightOf(one, out))).toEqual([10, 10, 10])
    expect(listHeight(out)).toBe(100)
  })

  /** The rows of the band that are still flat are not in the page: they are noughts
   *  high, stacked at the bottom of the band, and nobody can see them. */
  test('so a band coming out mounts only the part of it that is showing', () => {
    const view = windowFor({ ...folding(1.5), room: 45 })
    expect(view.last).toBe(4)
  })

  test('and the boxes above and below still add up to the list', () => {
    const half = folding(1.5)
    const view = windowFor({ ...half, room: 30, top: 20 })
    const drawn = [view.first, view.last].map((one) => offsetOf(one, half))

    expect(view.above).toBe(drawn[0])
    expect(view.above + view.below).toBeLessThan(listHeight(half))
  })

  /** A note holding four hundred notes is four hundred rows flat against the band's
   *  edge for the first frame of the slide, and every one of them would otherwise be
   *  mounted for nothing: they are inside the window, because everything under the
   *  band is. A row no pixels high adds no pixels to the flow, so they are left out. */
  test('and never mounts the part of the band that is still flat', () => {
    const shut = { ...folding(0), room: 100 }
    expect(windowFor(shut)).toMatchObject({ first: 0, last: 9, skip: { from: 3, to: 5 } })

    const half = { ...folding(1.5), room: 100 }
    // One row of the band is whole, one is part way out and one is still flat.
    expect(windowFor(half).skip).toEqual({ from: 5, to: 5 })

    expect(windowFor({ ...folding(3), room: 100 }).skip).toBeNull()
  })

  test('and the row a pixel is in is the row the arithmetic says', () => {
    const half = folding(1.5)
    const found = [0, 29, 30, 44, 45, 54, 55].map((one) => indexAt(one, half))

    expect(found).toEqual([0, 2, 3, 4, 6, 6, 7])
  })
})

/** A focus inside a row the window has taken away is a focus on nothing, and the
 *  arrows stop working. So a few rows are held wherever they are. */
describe('the rows the list holds on to', () => {
  test('are held although the scroll has left them far behind', () => {
    expect(windowFor(rows({ pinned: [2500] })).pinned).toEqual([2500])
    expect(mounted({ pinned: [2500] })).toBe(21)
  })

  test('and are not drawn twice when the window has them anyway', () => {
    expect(windowFor(rows({ pinned: [10] })).pinned).toEqual([])
    expect(mounted({ pinned: [10] })).toBe(20)
  })

  /** The keyboard, a name being typed and a row a key has asked for, which are
   *  usually one row named three times. */
  test('are named once each, in order, however often they are named', () => {
    expect(windowFor(rows({ pinned: [2500, 40, 2500] })).pinned).toEqual([40, 2500])
  })

  test('and never a row the list has not got', () => {
    expect(windowFor(rows({ pinned: [-1, 9999] })).pinned).toEqual([])
  })

  test('and nobody at all when nothing has the keyboard', () => {
    expect(windowFor(rows()).pinned).toEqual([])
  })

  /** A row in the flat part of a sliding band is inside the slice and still not
   *  drawn, so a pin there has to be held like any other. */
  test('including one inside the part of a band that is still flat', () => {
    const shut = { ...folding(0), room: 100, pinned: [4] }
    expect(windowFor(shut).pinned).toEqual([4])
  })
})

/** A drop can only land on a row that is there, and a space of three thousand has
 *  one row on screen in a hundred. So holding near an edge brings rows in. */
describe('a drag held near the edge of the list', () => {
  const near = (y: number) => autoScrollBy(y, ROOM, HEIGHT, HEIGHT / 2)

  test('scrolls nothing from the middle', () => {
    expect(near(ROOM / 2)).toBe(0)
  })

  test('scrolls up at the top and down at the bottom', () => {
    expect(near(0)).toBe(-HEIGHT / 2)
    expect(near(ROOM)).toBe(HEIGHT / 2)
  })

  test('faster the closer to the edge it is', () => {
    expect(near(HEIGHT / 2)).toBe(-HEIGHT / 4)
    expect(near(ROOM - HEIGHT / 2)).toBe(HEIGHT / 4)
  })

  test('and nothing at all over a list with no room to scroll', () => {
    expect(autoScrollBy(0, 0, HEIGHT, HEIGHT / 2)).toBe(0)
  })
})
