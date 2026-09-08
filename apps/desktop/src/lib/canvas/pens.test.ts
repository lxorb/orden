import { beforeEach, describe, expect, test } from 'vitest'
import { INK_STYLES } from './ink'
import {
  clampRub,
  clampSize,
  LEAST_RUB,
  LEAST_WIDTH,
  MOST_PENS,
  MOST_RECENT,
  MOST_RUB,
  MOST_WIDTH,
  nibFor,
  pens,
  readPens,
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

describe('keeping another pen', () => {
  test('adds it at the end and puts it in your hand', () => {
    expect(pens.add('marker')).toBe(true)
    expect(pens.list).toHaveLength(4)
    expect(pens.at).toBe(3)
    expect(pens.current.tool).toBe('marker')
  })

  test('gives it the colour the pen before it was writing in', () => {
    pens.set({ colour: '#00ff00' })
    pens.add('brush')

    expect(pens.current.colour).toBe('#00ff00')
  })

  test('refuses once the row is full', () => {
    while (pens.list.length < MOST_PENS) expect(pens.add('pen')).toBe(true)

    expect(pens.add('pen')).toBe(false)
    expect(pens.list).toHaveLength(MOST_PENS)
  })
})

describe('putting a pen away', () => {
  test('takes it out of the row', () => {
    pens.remove(1)
    expect(pens.list.map((one) => one.tool)).toEqual(['pen', 'highlighter'])
  })

  test('keeps the same pen in hand when one before it goes', () => {
    pens.pick(2)
    pens.remove(0)

    expect(pens.at).toBe(1)
    expect(pens.current.tool).toBe('highlighter')
  })

  test('never takes the last one', () => {
    pens.remove(2)
    pens.remove(1)
    pens.remove(0)

    expect(pens.list).toHaveLength(1)
  })

  test('leaves a pen in hand when the one in hand goes', () => {
    pens.pick(2)
    pens.remove(2)

    expect(pens.at).toBe(1)
    expect(pens.current.tool).toBe('pencil')
  })
})

describe('dragging a pen along the row', () => {
  test('puts it where it was dropped', () => {
    pens.move(0, 2)
    expect(pens.list.map((one) => one.tool)).toEqual(['pencil', 'highlighter', 'pen'])
  })

  test('keeps the pen that was out in hand wherever it lands', () => {
    pens.pick(2)
    pens.move(2, 0)

    expect(pens.at).toBe(0)
    expect(pens.current.tool).toBe('highlighter')
  })

  test('leaves the row alone when the drag went nowhere', () => {
    const was = pens.list
    pens.move(1, 1)
    pens.move(1, 9)

    expect(pens.list).toBe(was)
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
    const written = JSON.stringify({
      pens: [{ tool: 'marker', size: 5, opacity: 0.4, colour: '#abcdef' }],
      at: 0,
      recent: ['#abcdef'],
      dock: 'top',
      shut: true,
      whole: true,
      rub: 24,
    })

    expect(readPens(written)).toEqual({
      pens: [{ tool: 'marker', size: 5, opacity: 0.4, colour: '#abcdef' }],
      at: 0,
      recent: ['#abcdef'],
      dock: 'top',
      shut: true,
      whole: true,
      rub: 24,
    })
  })

  test('drops a pen it cannot read and keeps the rest', () => {
    const written = JSON.stringify({
      pens: [{ tool: 'pen' }, { tool: 'nonsense' }, 7, null, { tool: 'brush' }],
    })

    expect(readPens(written).pens.map((one) => one.tool)).toEqual(['pen', 'brush'])
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

  test('keeps no more pens than the bar shows', () => {
    const many = Array.from({ length: MOST_PENS + 5 }, () => ({ tool: 'pen' }))
    expect(readPens(JSON.stringify({ pens: many })).pens).toHaveLength(MOST_PENS)
  })

  test('brings an index that is past the end back into the row', () => {
    expect(readPens(JSON.stringify({ pens: [{ tool: 'pen' }], at: 6 })).at).toBe(0)
    expect(readPens(JSON.stringify({ at: -3 })).at).toBe(0)
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
