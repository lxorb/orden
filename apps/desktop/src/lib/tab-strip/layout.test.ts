import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  clampedStart,
  crossTakes,
  endOf,
  fitted,
  holds,
  keptWidths,
  moved,
  near,
  OPENING,
  nearestSlot,
  partsFor,
  placed,
  reorderSlack,
  separated,
  slotAt,
  trailing,
  widened,
  OPENED_LEAST,
  WIDTH,
  widthsFor,
  worthKeeping,
} from './layout'

function strip(shape: string) {
  return Array.from({ length: shape.length }, (_, at) => shape.charAt(at)).map((letter) => ({
    icon: letter === 'p' || letter === 'P',
    active: letter === 'A' || letter === 'P',
  }))
}

const total = (widths: readonly number[]) => widths.reduce((all, one) => all + one, 0)

describe('how wide the tabs are', () => {
  test('with room to spare every tab is the standard width', () => {
    expect(widthsFor(strip('aAa'), 2000)).toEqual([238, 238, 238])
  })

  test('before the strip is measured, too', () => {
    expect(widthsFor(strip('aAap'), null)).toEqual([238, 238, 238, WIDTH.icon])
  })

  test('short of room they share it out evenly and fill it exactly', () => {
    const widths = widthsFor(strip('aAaa'), 601)
    expect(total(widths)).toBe(601)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
    expect(widths[0]).toBeGreaterThanOrEqual(widths[3] ?? 0)
  })

  test('a tab drawn as its mark keeps its width whatever the room', () => {
    for (const room of [100, 400, 5000]) {
      expect(widthsFor(strip('pPaA'), room).slice(0, 2)).toEqual([WIDTH.icon, WIDTH.icon])
    }
  })

  test('the active tab stops at its least width, and only the others go on shrinking', () => {
    const tabs = strip('aaaaAaaaaa')
    const crossover = 10 * WIDTH.active
    const widths = widthsFor(tabs, crossover - 90)

    expect(widths[4]).toBe(WIDTH.active)
    for (const [at, width] of widths.entries()) {
      if (at !== 4) expect(width).toBeLessThan(WIDTH.active)
    }
    expect(total(widths)).toBe(crossover - 90)
  })

  test('and nothing gets narrower than the least widths, however little room', () => {
    const widths = widthsFor(strip('aAa'), 10)
    expect(widths).toEqual([WIDTH.inactive, WIDTH.active, WIDTH.inactive])
  })

  test('twenty tabs in a narrow window still fit', () => {
    const tabs = strip(`A${'a'.repeat(19)}`)
    const widths = widthsFor(tabs, 700)
    expect(total(widths)).toBe(700)
    expect(widths[0]).toBe(WIDTH.active)
    expect(Math.min(...widths)).toBeGreaterThan(WIDTH.inactive)
  })
})

describe('where the tabs are', () => {
  test('one after the other, and the plus after the last', () => {
    const bounds = placed([100, 50, 30])
    expect(bounds.map((one) => one.x)).toEqual([0, 100, 150])
    expect(endOf(bounds)).toBe(180)
    expect(endOf([])).toBe(0)
  })
})

describe('what fits in a tab', () => {
  const inactive = { icon: false, active: false }
  const active = { icon: false, active: true }

  test('a standard tab shows everything', () => {
    expect(partsFor(238, inactive)).toEqual({
      mark: true,
      close: true,
      title: true,
      centred: false,
    })
  })

  test('an inactive tab drops its close button first', () => {
    expect(partsFor(90, inactive).close).toBe(true)
    expect(partsFor(89, inactive).close).toBe(false)
    expect(partsFor(89, inactive).mark).toBe(true)
  })

  test('and a finger needs a wider tab before the cross is safe to show', () => {
    expect(partsFor(110, inactive, true).close).toBe(false)
    expect(partsFor(122, inactive, true).close).toBe(true)
  })

  test('the active tab keeps its close button and drops its mark', () => {
    expect(partsFor(WIDTH.active, active)).toEqual({
      mark: false,
      close: true,
      title: false,
      centred: false,
    })
    expect(partsFor(WIDTH.active + 19, active).mark).toBe(false)
    expect(partsFor(WIDTH.active + 20, active).mark).toBe(true)
  })

  test('a sliver is its mark in the middle', () => {
    expect(partsFor(WIDTH.inactive + 4, inactive)).toEqual({
      mark: true,
      close: false,
      title: false,
      centred: true,
    })
  })

  test('a tab drawn as an icon is its mark at its leading edge, and never a cross', () => {
    expect(partsFor(WIDTH.icon, { icon: true, active: true })).toEqual({
      mark: true,
      close: false,
      title: false,
      centred: false,
    })
  })

  test('a tab on its way in or out shows nothing', () => {
    expect(partsFor(6, active)).toEqual({ mark: false, close: false, title: false, centred: false })
  })
})

describe('a tab drawn as its mark, opened out under the pointer (#1041)', () => {
  test('opens to the standard width where there is room, the rest where they were', () => {
    const widths = [46, 238, 46, 46]
    const opened = widened(widths, 2, 2000)
    expect(opened[2]).toBe(WIDTH.standard)
    expect(opened.filter((_, at) => at !== 2)).toEqual([46, 238, 46])
  })

  test('opens far enough to read even with no room, pushing the rest along', () => {
    const widths = [46, 238, 46, 46]
    expect(widened(widths, 0, 376)[0]).toBe(OPENED_LEAST)
    expect(placed(widened(widths, 2, 376))[2]?.x).toBe(placed(widths)[2]?.x)
  })

  test('never narrows a tab', () => {
    expect(widened([238, 238], 1, 476)[1]).toBe(238)
  })
})

describe('where a drop from outside lands', () => {
  const bounds = placed([100, 100, 100])

  test('before the tab whose middle the pointer has not reached', () => {
    expect(slotAt(bounds, 10)).toBe(0)
    expect(slotAt(bounds, 60)).toBe(1)
    expect(slotAt(bounds, 149)).toBe(1)
    expect(slotAt(bounds, 151)).toBe(2)
    expect(slotAt(bounds, 1000)).toBe(3)
  })
})

describe('where a dragged tab belongs', () => {
  const widths = [100, 100, 100, 100]

  test("where it is, until it has passed a neighbour's middle", () => {
    expect(nearestSlot(widths, 0, 0)).toBe(0)
    expect(nearestSlot(widths, 0, 49)).toBe(0)
    expect(nearestSlot(widths, 0, 51)).toBe(1)
    expect(nearestSlot(widths, 0, 290)).toBe(3)
  })

  test('and back the same way', () => {
    expect(nearestSlot(widths, 3, 251)).toBe(3)
    expect(nearestSlot(widths, 3, 249)).toBe(2)
    expect(nearestSlot(widths, 3, -40)).toBe(0)
  })

  test('with tabs of different widths it measures the slot, not the tab', () => {
    expect(nearestSlot([40, 200, 100], 1, 19)).toBe(0)
    expect(nearestSlot([40, 200, 100], 1, 21)).toBe(1)
  })

  test('a tie keeps the slot it has', () => {
    expect(nearestSlot(widths, 0, 50)).toBe(0)
    expect(nearestSlot(widths, 0, 50, 1)).toBe(1)
  })

  test('a narrower tab needs less movement before the next reorder', () => {
    expect(reorderSlack(WIDTH.standard)).toBe(16)
    expect(reorderSlack(WIDTH.standard / 2)).toBe(8)
  })

  test('it cannot be dragged off either end of the strip', () => {
    expect(clampedStart(-50, 100, 800)).toBe(0)
    expect(clampedStart(900, 100, 800)).toBe(700)
    expect(clampedStart(300, 100, 800)).toBe(300)
    expect(clampedStart(300, 100, 50)).toBe(0)
  })

  test('the order it leaves behind', () => {
    expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moved(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moved(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })
})

describe('when a carried tab leaves the strip', () => {
  const rect = { left: 100, top: 0, right: 900, bottom: 38 }

  test('fifteen pixels above or below it, or past either end', () => {
    expect(holds(rect, 500, 38 + 15, 15)).toBe(true)
    expect(holds(rect, 500, 38 + 16, 15)).toBe(false)
    expect(holds(rect, 500, -16, 15)).toBe(false)
    expect(holds(rect, 99, 20, 15)).toBe(false)
    expect(holds(rect, 900, 20, 15)).toBe(false)
  })
})

describe('closing tabs with the pointer', () => {
  const rect = { left: 0, top: 0, right: 800, bottom: 38 }

  test('only holds the widths while the tabs are narrower than they would like', () => {
    expect(worthKeeping(strip('aAa'), 2000)).toBe(false)
    expect(worthKeeping(strip('aAa'), 600)).toBe(true)
    expect(worthKeeping(strip('aAa'), null)).toBe(false)
  })

  test('the tabs that are left keep the widths they had', () => {
    const kept = new Map([
      ['a', 120],
      ['b', 120],
      ['c', 120],
    ])
    const left = [
      { id: 'a', icon: false, active: false },
      { id: 'c', icon: false, active: true },
    ]
    expect(keptWidths(left, kept)).toEqual([120, 120])
  })

  test('a narrow tab that becomes active is let out to the active least width', () => {
    const kept = new Map([['a', 20]])
    expect(keptWidths([{ id: 'a', icon: false, active: true }], kept)).toEqual([WIDTH.active])
  })

  test('and a tab that was not there ends it', () => {
    const kept = new Map([['a', 120]])
    expect(
      keptWidths(
        [
          { id: 'a', icon: false, active: false },
          { id: 'new', icon: false, active: true },
        ],
        kept,
      ),
    ).toBeNull()
  })

  test('until the pointer is forty below the strip or sixty past its end', () => {
    expect(near(rect, 400, 38 + 40, 1)).toBe(true)
    expect(near(rect, 400, 38 + 41, 1)).toBe(false)
    expect(near(rect, 860, 20, 1)).toBe(true)
    expect(near(rect, 861, 20, 1)).toBe(false)
    expect(near(rect, 400, -1, 1)).toBe(false)
  })

  test('where the end is the left, the slop is on the left', () => {
    expect(near(rect, -60, 20, -1)).toBe(true)
    expect(near(rect, 860, 20, -1)).toBe(false)
  })
})

describe('the hairlines between tabs', () => {
  test('between two plain tabs, never beside a filled one or after the last', () => {
    const shown = separated(['a', 'b', 'c', 'd', 'e'], new Set(['c']))
    expect([...shown]).toEqual(['a', 'd'])
  })

  test('every plain pair has one', () => {
    expect([...separated(['a', 'b', 'c'], new Set())]).toEqual(['a', 'b'])
  })
})

describe("a tab's cross as it opens out under the pointer", () => {
  test('takes no press until the tab has opened, and does then', () => {
    expect(crossTakes('a', 'a', null)).toBe(false)
    expect(crossTakes('a', 'a', 'b')).toBe(false)
    expect(crossTakes('a', 'a', 'a')).toBe(true)
  })

  test('on every other tab is as it was', () => {
    expect(crossTakes('b', 'a', null)).toBe(true)
    expect(crossTakes('b', null, null)).toBe(true)
  })

  test("waits as long as the strip's own width transition", () => {
    const tokens = readFileSync(
      new URL('../../../../../packages/themes/src/tokens.css', import.meta.url),
      'utf8',
    )
    expect(tokens).toContain(`--dur-base: ${OPENING}ms;`)
  })
})

describe('tabs as wide as their contents', () => {
  const orden = fitted(38)
  const tabs = [
    { icon: false, active: true, fit: orden },
    { icon: true, active: false, fit: fitted(120) },
  ]

  test('is the mark, the name, the close button and the insets', () => {
    expect(orden).toBe(11 + 16 + 6 + 38 + 20 + 11)
  })

  test('with the room, the active tab is its own width and an icon tab its mark', () => {
    expect(widthsFor(tabs, 2000)).toEqual([orden, WIDTH.icon])
  })

  test('still shrinks as before once the room runs out', () => {
    const narrow = widthsFor(
      [
        { icon: false, active: true, fit: fitted(200) },
        { icon: false, active: false, fit: fitted(200) },
      ],
      200,
    )
    expect(total(narrow)).toBeLessThanOrEqual(200)
    expect(narrow[0]).toBeGreaterThanOrEqual(WIDTH.active)
  })

  test('never grows past the standard width, and off is the standard width again', () => {
    expect(widthsFor([{ icon: false, active: true, fit: fitted(900) }], 2000)).toEqual([
      WIDTH.standard,
    ])
    expect(widthsFor([{ icon: false, active: true }], 2000)).toEqual([WIDTH.standard])
  })

  test('keeps a tab not in front wide enough to show its cross', () => {
    const short = fitted(4)
    expect(partsFor(short, { icon: false, active: false }).close).toBe(true)
  })

  test('opens an icon tab under the pointer to its own width, not the standard one', () => {
    const fit = fitted(40)
    expect(widened([orden, WIDTH.icon], 1, 2000, fit)[1]).toBe(fit)
    expect(widened([orden, WIDTH.icon], 1, 2000, fitted(400))[1]).toBe(WIDTH.standard)
  })

  test('counts what the tab wears after its name', () => {
    expect(trailing({})).toBe(0)
    expect(trailing({ reading: true, draft: true })).toBe(19 + 12)
    expect(fitted(40, trailing({ sound: true }))).toBe(fitted(40) + 19)
  })
})
