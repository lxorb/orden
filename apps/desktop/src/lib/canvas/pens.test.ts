import { beforeEach, describe, expect, test } from 'vitest'
import { INK_STYLES } from './ink'
import {
  clampRub,
  clampSize,
  DOCKS,
  LEAST_RUB,
  LEAST_WIDTH,
  MOST_RECENT,
  MOST_RUB,
  MOST_WIDTH,
  nearestDock,
  nibFor,
  PEN_SLOTS,
  pens,
  readPens,
  upright,
} from './pens.svelte'

/** The row of pens is one store the whole app shares, so every test starts it
 *  again from what a device that has never been drawn on would hold. */
beforeEach(() => {
  pens.restore(readPens(null))
})

describe('a pen as it comes', () => {
  test('takes the width and the alpha its own kind of nib has', () => {
    for (const [tool, style] of Object.entries(INK_STYLES)) {
      const nib = nibFor(tool as keyof typeof INK_STYLES)
      expect(nib.size, tool).toBe(style.size)
      expect(nib.opacity, tool).toBe(style.opacity)
    }
  })

  test('writes in the same ink the words are set in unless told otherwise', () => {
    expect(nibFor('pen').colour).toBe('ink')
    expect(nibFor('pen', '#ff0000').colour).toBe('#ff0000')
  })
})

describe('the row a device starts with', () => {
  test('holds something to write, sketch and mark with', () => {
    expect(pens.list.map((one) => one.tool)).toEqual(['pen', 'pencil', 'highlighter'])
    expect(pens.at).toBe(0)
    expect(pens.current.tool).toBe('pen')
  })

  test('sits against the bottom edge, unfolded, rubbing out what is under it', () => {
    expect(pens.dock).toBe('bottom')
    expect(pens.shut).toBe(false)
    expect(pens.whole).toBe(false)
  })
})

describe('picking a pen up', () => {
  test('takes the one asked for', () => {
    pens.pick(2)
    expect(pens.current.tool).toBe('highlighter')
  })

  test('ignores an index the row does not have', () => {
    pens.pick(9)
    expect(pens.at).toBe(0)

    pens.pick(-1)
    expect(pens.at).toBe(0)
  })
})

describe('setting the pen in hand', () => {
  test('changes that pen and no other', () => {
    pens.pick(1)
    pens.set({ size: 9 })

    expect(pens.list[1]?.size).toBe(9)
    expect(pens.list[0]?.size).toBe(INK_STYLES.pen.size)
    expect(pens.list[2]?.size).toBe(INK_STYLES.highlighter.size)
  })

  test('turns it into another kind of nib when asked', () => {
    pens.set(nibFor('calligraphy', '#123456'))

    expect(pens.current.tool).toBe('calligraphy')
    expect(pens.current.size).toBe(INK_STYLES.calligraphy.size)
    expect(pens.current.colour).toBe('#123456')
  })

  test('remembers a colour somebody mixed', () => {
    pens.set({ colour: '#abcdef' })
    expect(pens.recent).toEqual(['#abcdef'])
  })

  test('does not remember the presets, which are always on screen', () => {
    pens.set({ colour: '3' })
    pens.set({ colour: 'ink' })

    expect(pens.recent).toEqual([])
  })

  test('puts a colour used again at the front rather than twice in the row', () => {
    pens.set({ colour: '#111111' })
    pens.set({ colour: '#222222' })
    pens.set({ colour: '#111111' })

    expect(pens.recent).toEqual(['#111111', '#222222'])
  })

  test('remembers only as many colours as the row shows', () => {
    for (let one = 0; one < MOST_RECENT + 4; one++) {
      pens.set({ colour: `#0000${one.toString(16).padStart(2, '0')}` })
    }

    expect(pens.recent).toHaveLength(MOST_RECENT)
  })
})

/** Three slots, always three. Nothing to add, nothing to put away, nothing to
 *  drag into order: each of them is a pen, and setting one is the only thing
 *  anybody does to the row. */
describe('the three slots', () => {
  test('are what a device starts with and what it keeps', () => {
    expect(pens.list).toHaveLength(PEN_SLOTS)
  })

  test('are three however many pens the store held before', () => {
    const many = Array.from({ length: PEN_SLOTS + 5 }, () => ({ tool: 'marker' }))
    expect(readPens(JSON.stringify({ pens: many })).pens).toHaveLength(PEN_SLOTS)
  })

  test('are filled out of the box where the store held fewer', () => {
    const one = readPens(JSON.stringify({ pens: [{ tool: 'brush' }] }))

    expect(one.pens.map((pen) => pen.tool)).toEqual(['brush', 'pencil', 'highlighter'])
  })

  test('each hold a pen of their own, set the way it was set', () => {
    pens.pick(2)
    pens.set({ size: 22 })
    pens.pick(0)

    expect(pens.current.size).toBe(INK_STYLES.pen.size)
    pens.pick(2)
    expect(pens.current.size).toBe(22)
  })
})

describe('the lasso and what it catches', () => {
  test('is a loop until somebody asks for a box', () => {
    expect(pens.box).toBe(false)

    pens.catching({ box: true, partly: true })
    expect(pens.box).toBe(true)
    expect(pens.partly).toBe(true)
  })
})

describe('straightening', () => {
  test('is on to begin with and can be turned off', () => {
    expect(pens.straighten).toBe(true)

    pens.straightening(false)
    expect(pens.straighten).toBe(false)
  })
})

describe('the eraser', () => {
  test('says how it is set the way the pointer machine asks', () => {
    pens.rubbing({ whole: true, rub: 30 })
    expect(pens.eraser).toEqual({ whole: true, size: 30 })
  })

  test('keeps its width inside what a finger can judge', () => {
    pens.rubbing({ rub: 9999 })
    expect(pens.rub).toBe(MOST_RUB)

    pens.rubbing({ rub: 0 })
    expect(pens.rub).toBe(LEAST_RUB)
  })
})

describe('where the bar sits', () => {
  test('moves to an edge and folds away', () => {
    pens.dockTo('top')
    pens.fold(true)

    expect(pens.dock).toBe('top')
    expect(pens.shut).toBe(true)
  })
})

describe('what the store holds', () => {
  test('is the defaults when there is nothing in it', () => {
    const held = readPens(null)
    expect(held.pens).toHaveLength(3)
    expect(held.dock).toBe('bottom')
  })

  test('is the defaults when what is in it is not JSON', () => {
    expect(readPens('{{{').pens.map((one) => one.tool)).toEqual(['pen', 'pencil', 'highlighter'])
  })

  test('is the defaults when what is in it is not an object', () => {
    expect(readPens('7').pens).toHaveLength(3)
    expect(readPens('null').pens).toHaveLength(3)
  })

  test('comes back as it went in', () => {
    const row = [
      { tool: 'marker', size: 5, opacity: 0.4, colour: '#abcdef' },
      { tool: 'pen', size: 2, opacity: 1, colour: 'ink' },
      { tool: 'brush', size: 8, opacity: 1, colour: '1' },
    ]
    const written = JSON.stringify({
      pens: row,
      at: 1,
      recent: ['#abcdef'],
      dock: 'top',
      shut: true,
      whole: true,
      rub: 24,
      straighten: false,
      box: true,
      partly: true,
    })

    expect(readPens(written)).toEqual({
      pens: row,
      at: 1,
      recent: ['#abcdef'],
      dock: 'top',
      shut: true,
      whole: true,
      rub: 24,
      straighten: false,
      box: true,
      partly: true,
    })
  })

  test('drops a pen it cannot read and fills the slot back in', () => {
    const written = JSON.stringify({
      pens: [{ tool: 'pen' }, { tool: 'nonsense' }, 7, null, { tool: 'brush' }],
    })

    expect(readPens(written).pens.map((one) => one.tool)).toEqual(['pen', 'brush', 'highlighter'])
  })

  test('fills in what a half-written pen did not say', () => {
    const one = readPens(JSON.stringify({ pens: [{ tool: 'marker' }] })).pens[0]

    expect(one?.size).toBe(INK_STYLES.marker.size)
    expect(one?.opacity).toBe(INK_STYLES.marker.opacity)
    expect(one?.colour).toBe('ink')
  })

  test('starts again when every pen in it was broken', () => {
    expect(readPens(JSON.stringify({ pens: [{ tool: 'nope' }] })).pens).toHaveLength(3)
  })

  test('brings an index that is past the end back into the row', () => {
    expect(readPens(JSON.stringify({ pens: [{ tool: 'pen' }], at: 6 })).at).toBe(2)
    expect(readPens(JSON.stringify({ at: -3 })).at).toBe(0)
  })

  test('straightens what is drawn until somebody says otherwise', () => {
    expect(readPens(null).straighten).toBe(true)
    expect(readPens(JSON.stringify({ straighten: false })).straighten).toBe(false)
  })

  test('keeps only strings among the colours it remembered', () => {
    const written = JSON.stringify({ recent: ['#111111', 4, null, '#222222'] })
    expect(readPens(written).recent).toEqual(['#111111', '#222222'])
  })

  test('takes a width and an alpha no pen could have and makes them ones it could', () => {
    const one = readPens(JSON.stringify({ pens: [{ tool: 'pen', size: 9999, opacity: 40 }] }))
      .pens[0]

    expect(one?.size).toBe(MOST_WIDTH)
    expect(one?.opacity).toBe(1)
  })
})

describe('the dials', () => {
  test('hold a width between the finest line and the fattest', () => {
    expect(clampSize(0)).toBe(LEAST_WIDTH)
    expect(clampSize(1000)).toBe(MOST_WIDTH)
    expect(clampSize(4.44)).toBe(4.4)
    expect(clampSize(Number.NaN)).toBe(3)
  })

  test('hold an eraser between what is aimable and what is a wipe', () => {
    expect(clampRub(1)).toBe(LEAST_RUB)
    expect(clampRub(1000)).toBe(MOST_RUB)
    expect(clampRub(12.6)).toBe(13)
    expect(clampRub(Number.NaN)).toBe(10)
  })
})

/** Where the bar sits. All four edges, because a wrist rests somewhere different on
 *  every device and in every grip. It follows the finger while it is dragged and
 *  springs to whichever edge it was let go nearest, which is answered here. */
describe('which edge the bar springs to', () => {
  const pane = { width: 1000, height: 700 }

  test('is whichever one it was let go nearest', () => {
    expect(nearestDock({ x: 500, y: 660 }, pane.width, pane.height)).toBe('bottom')
    expect(nearestDock({ x: 500, y: 20 }, pane.width, pane.height)).toBe('top')
    expect(nearestDock({ x: 30, y: 350 }, pane.width, pane.height)).toBe('left')
    expect(nearestDock({ x: 970, y: 350 }, pane.width, pane.height)).toBe('right')
  })

  /** Nearest, not "whichever half of the screen": a bar dragged into the middle of a
   *  wide pane is nearer the top or the bottom than either side, and a bar in the
   *  middle of a tall one is nearer a side. */
  test('is measured rather than guessed from halves', () => {
    expect(nearestDock({ x: 480, y: 300 }, 1000, 700)).toBe('top')
    expect(nearestDock({ x: 300, y: 480 }, 700, 1000)).toBe('left')
  })

  test('says which edges stand the bar on its end', () => {
    expect(upright('left')).toBe(true)
    expect(upright('right')).toBe(true)
    expect(upright('top')).toBe(false)
    expect(upright('bottom')).toBe(false)
  })

  test('is remembered, and any of the four reads back', () => {
    for (const dock of DOCKS) {
      pens.dockTo(dock)
      expect(pens.dock).toBe(dock)
      expect(readPens(JSON.stringify({ dock })).dock).toBe(dock)
    }
  })

  test('falls back to the bottom for an edge nobody has heard of', () => {
    expect(readPens(JSON.stringify({ dock: 'sideways' })).dock).toBe('bottom')
  })
})
