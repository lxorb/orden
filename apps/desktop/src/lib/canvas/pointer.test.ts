import { describe, expect, test } from 'vitest'
import {
  type Context,
  type Down,
  type Effect,
  type Hit,
  type Input,
  type Machine,
  NOTHING,
  start,
  step,
  type Tool,
} from './pointer'

/** The machine has no DOM in it, so a gesture is a list of values and a test is
 *  that list written down. Everything below is one sequence of events and what
 *  the machine said about it. */

const HERE = { x: 0, y: 0 }

function context(over: Partial<Context> = {}): Context {
  return {
    tool: 'select',
    picked: [],
    editing: null,
    scale: 1,
    inkBox: null,
    pen: { tool: 'pen', size: 3, color: '#000' },
    ...over,
  }
}

function down(over: Partial<Down> = {}): Down {
  return {
    kind: 'down',
    id: 1,
    pointer: 'mouse',
    at: HERE,
    screen: HERE,
    button: 0,
    shift: false,
    adds: false,
    eraser: false,
    sample: { x: 0, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
    hit: NOTHING,
    ...over,
  }
}

function hit(over: Partial<Hit>): Hit {
  return { ...NOTHING, ...over }
}

/** A whole gesture, as one call: the machine after it and everything it asked
 *  for along the way. */
function play(inputs: Input[], where: Context, from: Machine = start()) {
  let machine = from
  const effects: Effect[] = []

  for (const input of inputs) {
    const next = step(machine, input, where)
    machine = next.machine
    effects.push(...next.effects)
  }

  return { machine, effects }
}

const verbs = (effects: Effect[]) => effects.map((one) => one.do)

describe('picking with the arrow', () => {
  test('a press on a card picks it and starts carrying it', () => {
    const { machine, effects } = play([down({ hit: hit({ node: 'a' }) })], context())

    expect(verbs(effects)).toEqual(['leave', 'pick'])
    expect(machine.gesture).toMatchObject({ kind: 'drag', ids: ['a'] })
  })

  /** A press on one of nine picked cards drags all nine: grabbing one of them
   *  is not a reason to drop the other eight. */
  test('a press on something already picked keeps the whole selection', () => {
    const where = context({ picked: ['a', 'b', 'c'] })
    const { machine, effects } = play([down({ hit: hit({ node: 'b' }) })], where)

    expect(verbs(effects)).toEqual(['leave'])
    expect(machine.gesture).toMatchObject({ kind: 'drag', ids: ['a', 'b', 'c'] })
  })

  test('shift adds to what is picked and takes an already-picked one out', () => {
    const added = play([down({ hit: hit({ node: 'c' }), shift: true })], context({ picked: ['a'] }))
    expect(added.machine.gesture).toMatchObject({ ids: ['a', 'c'] })

    const removed = play(
      [down({ hit: hit({ node: 'a' }), shift: true })],
      context({ picked: ['a', 'b'] }),
    )
    expect(removed.machine.gesture).toMatchObject({ ids: ['b'] })
  })

  test('a press on nothing clears what was picked and bands', () => {
    const { machine, effects } = play([down()], context({ picked: ['a'] }))

    expect(verbs(effects)).toEqual(['leave', 'clear'])
    expect(machine.gesture?.kind).toBe('band')
  })

  test('a card being written in keeps its own pointer', () => {
    const { machine, effects } = play(
      [down({ hit: hit({ node: 'a' }) })],
      context({ editing: 'a', picked: ['a'] }),
    )

    expect(effects).toEqual([])
    expect(machine.gesture).toBeNull()
  })
})

describe('dragging', () => {
  const where = context()

  test('says how far it went, once, when the pointer comes up', () => {
    const { effects } = play(
      [
        down({ hit: hit({ node: 'a' }) }),
        {
          kind: 'move',
          id: 1,
          at: { x: 40, y: 20 },
          screen: { x: 40, y: 20 },
          samples: [],
          hit: NOTHING,
        },
        {
          kind: 'move',
          id: 1,
          at: { x: 80, y: 20 },
          screen: { x: 80, y: 20 },
          samples: [],
          hit: NOTHING,
        },
        { kind: 'up', id: 1, at: { x: 80, y: 20 }, screen: { x: 80, y: 20 }, hit: NOTHING },
      ],
      where,
    )

    const moves = effects.filter((one) => one.do === 'move')
    expect(moves).toEqual([{ do: 'move', ids: ['a'], dx: 80, dy: 20 }])
  })

  /** A hand that presses and lets go without meaning to move is a click, and a
   *  click has nothing to record. */
  test('a drag that was really a click records nothing', () => {
    const { effects } = play(
      [
        down({ hit: hit({ node: 'a' }) }),
        {
          kind: 'move',
          id: 1,
          at: { x: 1, y: 1 },
          screen: { x: 1, y: 1 },
          samples: [],
          hit: NOTHING,
        },
        { kind: 'up', id: 1, at: { x: 1, y: 1 }, screen: { x: 1, y: 1 }, hit: NOTHING },
      ],
      where,
    )

    expect(verbs(effects)).toEqual(['leave', 'pick'])
  })

  test('is measured in plane units, so a zoomed-out drag moves further', () => {
    const { effects } = play(
      [
        down({ hit: hit({ node: 'a' }) }),
        { kind: 'move', id: 1, at: HERE, screen: { x: 100, y: 0 }, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: HERE, screen: { x: 100, y: 0 }, hit: NOTHING },
      ],
      context({ scale: 0.5 }),
    )

    expect(effects.at(-1)).toEqual({ do: 'move', ids: ['a'], dx: 200, dy: 0 })
  })
})

describe('panning', () => {
  test('space turns any press into a pan, even over a card', () => {
    const held = step(start(), { kind: 'space', down: true }, context()).machine
    const { machine } = play([down({ hit: hit({ node: 'a' }) })], context(), held)

    expect(machine.gesture?.kind).toBe('pan')
  })

  test('the middle button pans from anywhere', () => {
    const { machine } = play([down({ button: 1, hit: hit({ node: 'a' }) })], context())
    expect(machine.gesture?.kind).toBe('pan')
  })

  test('one finger on the plane pans rather than bands', () => {
    const { machine } = play([down({ pointer: 'touch' })], context())
    expect(machine.gesture?.kind).toBe('pan')
  })

  /** A mouse says "nothing, thank you" the moment it is pressed on the plane. A
   *  finger cannot, because the same press is how the plane is moved, so it says
   *  it on the way up instead. */
  test('a finger tapped on the plane and lifted clears what was picked', () => {
    const { effects } = play(
      [down({ pointer: 'touch' }), { kind: 'up', id: 1, at: HERE, screen: HERE, hit: NOTHING }],
      context({ picked: ['a'] }),
    )

    expect(verbs(effects)).toEqual(['leave', 'clear'])
  })

  test('a finger that panned and lifted leaves what was picked alone', () => {
    const { effects } = play(
      [
        down({ pointer: 'touch' }),
        { kind: 'move', id: 1, at: HERE, screen: { x: 60, y: 0 }, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: HERE, screen: { x: 60, y: 0 }, hit: NOTHING },
      ],
      context({ picked: ['a'] }),
    )

    expect(verbs(effects)).toEqual(['leave', 'pan'])
  })

  test('a pan says how far the plane moved, on screen', () => {
    const { effects } = play(
      [
        down({ button: 1 }),
        { kind: 'move', id: 1, at: HERE, screen: { x: 30, y: -10 }, samples: [], hit: NOTHING },
      ],
      context(),
    )

    expect(effects).toEqual([{ do: 'pan', dx: 30, dy: -10 }])
  })
})

describe('two fingers', () => {
  const pinch: Input[] = [
    down({ id: 1, pointer: 'touch', screen: { x: 0, y: 0 } }),
    down({ id: 2, pointer: 'touch', screen: { x: 100, y: 0 } }),
    { kind: 'move', id: 2, at: HERE, screen: { x: 200, y: 0 }, samples: [], hit: NOTHING },
  ]

  test('a second finger turns a pan into a pinch', () => {
    const { machine } = play(pinch.slice(0, 2), context())
    expect(machine.gesture).toMatchObject({ kind: 'pinch', apart: 100 })
  })

  test('spreading them zooms in about the middle of the two', () => {
    const { effects } = play(pinch, context())
    const zoom = effects.find((one) => one.do === 'zoom')

    expect(zoom).toEqual({ do: 'zoom', at: { x: 100, y: 0 }, by: 2 })
  })

  /** Each finger arrives in an event of its own, so a pair moved together is a
   *  wobble in and a wobble out that come to nothing: what matters is that the
   *  two are as far apart as they started, and that the plane moved by what the
   *  hand moved. */
  test('moving them together comes out as a pan and no zoom at all', () => {
    const { machine, effects } = play(
      [
        ...pinch.slice(0, 2),
        { kind: 'move', id: 1, at: HERE, screen: { x: 20, y: 0 }, samples: [], hit: NOTHING },
        { kind: 'move', id: 2, at: HERE, screen: { x: 120, y: 0 }, samples: [], hit: NOTHING },
      ],
      context(),
    )

    expect(machine.gesture).toMatchObject({ apart: 100 })

    const zooms = effects.filter((one) => one.do === 'zoom')
    expect(zooms.reduce((all, one) => all * one.by, 1)).toBeCloseTo(1)

    const pans = effects.filter((one) => one.do === 'pan')
    expect(pans.reduce((all, one) => all + one.dx, 0)).toBe(20)
  })

  test('lifting one goes back to panning with the other', () => {
    const { machine } = play(
      [...pinch, { kind: 'up', id: 2, at: HERE, screen: { x: 200, y: 0 }, hit: NOTHING }],
      context(),
    )

    expect(machine.gesture).toMatchObject({ kind: 'pan', id: 1 })
  })
})

/** A hand resting on a tablet is touch, and a pen that has arrived means the
 *  hand is not what anybody is drawing with. */
describe('palm rejection', () => {
  test('a finger is ignored while a pen is on the glass', () => {
    const pen = play([down({ id: 1, pointer: 'pen' })], context({ tool: 'draw' }))
    expect(pen.machine.penDown).toBe(true)

    const palm = step(pen.machine, down({ id: 2, pointer: 'touch' }), context({ tool: 'draw' }))
    expect(palm.machine.gesture).toBe(pen.machine.gesture)
    expect(palm.effects).toEqual([])
  })

  /** A hand coming off the glass is not the pen putting its stroke down. */
  test('a palm lifting does not end the stroke the pen is still drawing', () => {
    const where = context({ tool: 'draw' })
    const drawing = play(
      [
        down({ id: 1, pointer: 'pen' }),
        {
          kind: 'move',
          id: 1,
          at: { x: 9, y: 9 },
          screen: HERE,
          samples: [{ x: 9, y: 9, pressure: 0.7, tiltX: 0, tiltY: 0, t: 8 }],
          hit: NOTHING,
        },
      ],
      where,
    )

    const palm = step(
      drawing.machine,
      { kind: 'up', id: 7, at: HERE, screen: HERE, hit: NOTHING },
      where,
    )

    expect(palm.effects).toEqual([])
    expect(palm.machine.gesture?.kind).toBe('draw')

    const pen = step(
      palm.machine,
      { kind: 'up', id: 1, at: { x: 9, y: 9 }, screen: HERE, hit: NOTHING },
      where,
    )

    expect(verbs(pen.effects)).toEqual(['stroke'])
  })

  test('the glass answers a finger again once the pen is off it', () => {
    const pen = play(
      [
        down({ id: 1, pointer: 'pen' }),
        { kind: 'up', id: 1, at: HERE, screen: HERE, hit: NOTHING },
      ],
      context({ tool: 'draw' }),
    )

    expect(pen.machine.penDown).toBe(false)
    const finger = step(pen.machine, down({ id: 2, pointer: 'touch' }), context())
    expect(finger.machine.gesture?.kind).toBe('pan')
  })
})

describe('drawing', () => {
  const where = context({ tool: 'draw' })

  test('collects every sample the pen reported, not just the ones delivered', () => {
    const samples = [
      { x: 1, y: 1, pressure: 0.4, tiltX: 0, tiltY: 0, t: 4 },
      { x: 2, y: 2, pressure: 0.5, tiltX: 0, tiltY: 0, t: 8 },
    ]

    const { machine } = play(
      [
        down({ pointer: 'pen' }),
        { kind: 'move', id: 1, at: { x: 2, y: 2 }, screen: HERE, samples, hit: NOTHING },
      ],
      where,
    )

    expect(machine.gesture).toMatchObject({ kind: 'draw' })
    expect(machine.gesture?.kind === 'draw' && machine.gesture.stroke.points).toHaveLength(3)
  })

  test('hands the stroke over once, when the pen comes up', () => {
    const { effects } = play(
      [
        down({ pointer: 'pen' }),
        {
          kind: 'move',
          id: 1,
          at: { x: 5, y: 5 },
          screen: HERE,
          samples: [{ x: 5, y: 5, pressure: 0.6, tiltX: 3, tiltY: -2, t: 8 }],
          hit: NOTHING,
        },
        { kind: 'up', id: 1, at: { x: 5, y: 5 }, screen: HERE, hit: NOTHING },
      ],
      where,
    )

    const stroke = effects.filter((one) => one.do === 'stroke')
    expect(stroke).toHaveLength(1)
    expect(stroke[0]?.do === 'stroke' && stroke[0].stroke.tool).toBe('pen')
  })

  test('a dot with nowhere to go is not a stroke', () => {
    const { effects } = play(
      [down({ pointer: 'pen' }), { kind: 'up', id: 1, at: HERE, screen: HERE, hit: NOTHING }],
      where,
    )

    expect(effects.filter((one) => one.do === 'stroke')).toEqual([])
  })

  test('a held pen asks for its shape to be tidied', () => {
    const { effects } = play([down({ pointer: 'pen' }), { kind: 'held', at: HERE }], where)

    expect(verbs(effects)).toContain('assist')
  })

  /** Every stylus in the world rubs out when its button is held, whatever the
   *  bar happens to say. */
  test('the pen button rubs out whatever the tool is', () => {
    const { machine, effects } = play(
      [down({ pointer: 'pen', eraser: true })],
      context({ tool: 'draw' }),
    )

    expect(machine.gesture?.kind).toBe('erase')
    expect(verbs(effects)).toEqual(['cut'])
  })
})

describe('rubbing out', () => {
  test('cuts a hole under the eraser at every point of the drag', () => {
    const { effects } = play(
      [
        down(),
        { kind: 'move', id: 1, at: { x: 5, y: 0 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'move', id: 1, at: { x: 9, y: 0 }, screen: HERE, samples: [], hit: NOTHING },
      ],
      context({ tool: 'erase' }),
    )

    expect(verbs(effects)).toEqual(['cut', 'cut', 'cut'])
  })

  test('with shift it takes whole strokes instead, each one once', () => {
    const { effects } = play(
      [
        down({ shift: true, hit: hit({ stroke: 's1' }) }),
        { kind: 'move', id: 1, at: HERE, screen: HERE, samples: [], hit: hit({ stroke: 's1' }) },
        { kind: 'move', id: 1, at: HERE, screen: HERE, samples: [], hit: hit({ stroke: 's2' }) },
      ],
      context({ tool: 'erase' }),
    )

    expect(effects).toEqual([
      { do: 'rub', ids: ['s1'] },
      { do: 'rub', ids: ['s2'] },
    ])
  })
})

describe('the lasso', () => {
  test('collects the loop and asks what it caught', () => {
    const { effects } = play(
      [
        down(),
        { kind: 'move', id: 1, at: { x: 10, y: 0 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'move', id: 1, at: { x: 10, y: 10 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: { x: 10, y: 10 }, screen: HERE, hit: NOTHING },
      ],
      context({ tool: 'lasso' }),
    )

    const caught = effects.find((one) => one.do === 'catch')
    expect(caught?.do === 'catch' && caught.lasso).toHaveLength(3)
  })

  test('a press inside what it caught moves the lot', () => {
    const where = context({
      tool: 'lasso',
      picked: ['s1'],
      inkBox: { x: 0, y: 0, width: 100, height: 100 },
    })

    const { effects } = play(
      [
        down({ at: { x: 50, y: 50 }, hit: hit({ ink: 'inside' }) }),
        { kind: 'move', id: 1, at: { x: 70, y: 50 }, screen: HERE, samples: [], hit: NOTHING },
      ],
      where,
    )

    expect(effects).toEqual([
      { do: 'ink', dx: 20, dy: 0, scale: 1, turn: 0, about: { x: 50, y: 50 } },
    ])
  })
})

describe('the tools that put something down', () => {
  test('put it where the pointer was and nowhere else', () => {
    for (const tool of ['text', 'file', 'link', 'group'] as Tool[]) {
      const { machine, effects } = play([down({ at: { x: 30, y: 40 } })], context({ tool }))

      expect(effects).toEqual([{ do: 'place', tool, at: { x: 30, y: 40 } }])
      expect(machine.gesture).toBeNull()
    }
  })

  test('a shape is dragged out and made once, on the way up', () => {
    const { effects } = play(
      [
        down({ at: { x: 0, y: 0 } }),
        { kind: 'move', id: 1, at: { x: 60, y: 40 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: { x: 60, y: 40 }, screen: HERE, hit: NOTHING },
      ],
      context({ tool: 'rect' }),
    )

    expect(effects).toEqual([
      { do: 'shape', tool: 'rect', from: { x: 0, y: 0 }, to: { x: 60, y: 40 } },
    ])
  })

  test('a shape nobody dragged is not a shape', () => {
    const { effects } = play(
      [down(), { kind: 'up', id: 1, at: HERE, screen: HERE, hit: NOTHING }],
      context({ tool: 'ellipse' }),
    )

    expect(effects).toEqual([])
  })
})

describe('connecting', () => {
  test('is drawn from a dot and lands on whatever is under the pointer', () => {
    const { effects } = play(
      [
        down({ hit: hit({ port: { id: 'a', side: 'right' } }) }),
        { kind: 'move', id: 1, at: { x: 200, y: 0 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: { x: 200, y: 0 }, screen: HERE, hit: hit({ node: 'b' }) },
      ],
      context(),
    )

    expect(effects).toEqual([
      { do: 'connect', from: 'a', fromSide: 'right', to: 'b', toSide: 'auto' },
    ])
  })

  test('dropped on nothing is nothing', () => {
    const { effects } = play(
      [
        down({ hit: hit({ port: { id: 'a', side: 'right' } }) }),
        { kind: 'up', id: 1, at: { x: 200, y: 0 }, screen: HERE, hit: NOTHING },
      ],
      context(),
    )

    expect(effects).toEqual([])
  })
})

describe('what a gesture leaves behind', () => {
  test('a cancelled pointer leaves nothing half done', () => {
    const { machine } = play(
      [down({ pointer: 'pen' }), { kind: 'cancel', id: 1 }],
      context({ tool: 'draw' }),
    )

    expect(machine.gesture).toBeNull()
    expect(machine.penDown).toBe(false)
  })

  test('the right button asks for the menu and starts nothing', () => {
    const { machine, effects } = play([down({ button: 2, at: { x: 4, y: 5 } })], context())

    expect(effects).toEqual([{ do: 'menu', at: { x: 4, y: 5 } }])
    expect(machine.gesture).toBeNull()
  })

  test('a finger held on the plane asks for the menu', () => {
    const { effects } = play(
      [down({ pointer: 'touch' }), { kind: 'held', at: { x: 7, y: 8 } }],
      context(),
    )

    expect(effects.at(-1)).toEqual({ do: 'menu', at: { x: 7, y: 8 } })
  })
})
