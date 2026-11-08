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
import type { InkStroke } from './format'
import { nearStroke } from './ink'
import { RUB, STROKE_RUB } from './pens.svelte'

const HERE = { x: 0, y: 0 }

function context(over: Partial<Context> = {}): Context {
  return {
    tool: 'select',
    picked: [],
    editing: null,
    scale: 1,
    inkBox: null,
    pen: { tool: 'pen', size: 3, color: '#000', opacity: 1 },
    eraser: { whole: false, size: RUB, stroke: STROKE_RUB },
    lassoBox: false,
    aspect: false,
    straighten: true,
    penSeen: false,
    fingerDraws: false,
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
    time: 0,
    button: 0,
    shift: false,
    adds: false,
    alt: false,
    eraser: false,
    sample: { x: 0, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
    hit: NOTHING,
    ...over,
  }
}

function hit(over: Partial<Hit>): Hit {
  return { ...NOTHING, ...over }
}

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

  test('a band says what it covers as it is dragged', () => {
    const { effects } = play(
      [
        down(),
        {
          kind: 'move',
          id: 1,
          at: { x: 90, y: 60 },
          screen: { x: 90, y: 60 },
          samples: [],
          hit: NOTHING,
        },
        { kind: 'up', id: 1, at: { x: 90, y: 60 }, screen: { x: 90, y: 60 }, hit: NOTHING },
      ],
      context({ picked: ['a'] }),
    )

    const bands = effects.filter((one) => one.do === 'band')
    expect(bands).toEqual([
      { do: 'band', from: HERE, to: { x: 90, y: 60 }, was: [], adding: false },
    ])
  })

  test('a band held with shift keeps what was already picked', () => {
    const { effects } = play(
      [
        down({ shift: true }),
        {
          kind: 'move',
          id: 1,
          at: { x: 9, y: 6 },
          screen: { x: 9, y: 6 },
          samples: [],
          hit: NOTHING,
        },
      ],
      context({ picked: ['a'] }),
    )

    expect(effects.filter((one) => one.do === 'band')).toEqual([
      { do: 'band', from: HERE, to: { x: 9, y: 6 }, was: ['a'], adding: true },
    ])
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

  test('a pointer that is not carrying the card does not move it', () => {
    const { effects } = play(
      [
        down({ id: 2, pointer: 'touch', hit: hit({ node: 'a' }) }),
        {
          kind: 'move',
          id: 1,
          at: { x: 300, y: 300 },
          screen: { x: 300, y: 300 },
          samples: [],
          hit: NOTHING,
        },
        {
          kind: 'move',
          id: 2,
          at: { x: 40, y: 20 },
          screen: { x: 40, y: 20 },
          samples: [],
          hit: NOTHING,
        },
        {
          kind: 'move',
          id: 1,
          at: { x: 310, y: 310 },
          screen: { x: 310, y: 310 },
          samples: [],
          hit: NOTHING,
        },
        { kind: 'up', id: 2, at: { x: 40, y: 20 }, screen: { x: 40, y: 20 }, hit: NOTHING },
      ],
      where,
    )

    expect(effects.filter((one) => one.do === 'move')).toEqual([
      { do: 'move', ids: ['a'], dx: 40, dy: 20 },
    ])
  })

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

describe('two fingers turning the view (#351)', () => {
  function swung(degrees: number, steps = 6): Input[] {
    const moves: Input[] = []
    for (let step = 1; step <= steps; step++) {
      const angle = ((degrees * step) / steps) * (Math.PI / 180)
      moves.push({
        kind: 'move',
        id: 2,
        at: HERE,
        screen: { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) },
        samples: [],
        hit: NOTHING,
      })
    }
    return [
      down({ id: 1, pointer: 'touch', screen: { x: 0, y: 0 } }),
      down({ id: 2, pointer: 'touch', screen: { x: 100, y: 0 } }),
      ...moves,
    ]
  }

  const turnedBy = (effects: Effect[]) =>
    effects.reduce((all, one) => all + (one.do === 'turn' ? one.by : 0), 0)

  test('turn it with them, past the deadband, where the setting is on', () => {
    const { effects } = play(swung(40), context({ turns: true }))
    expect(turnedBy(effects)).toBeGreaterThan((30 * Math.PI) / 180)
    expect(turnedBy(effects)).toBeLessThanOrEqual((40 * Math.PI) / 180 + 1e-9)
  })

  test('turn nothing at all where the setting is off', () => {
    const { effects } = play(swung(40), context({ turns: false }))
    expect(verbs(effects)).not.toContain('turn')
  })

  test('and a pinch held a little crooked turns nothing', () => {
    const { effects } = play(swung(4), context({ turns: true }))
    expect(verbs(effects)).not.toContain('turn')
  })

  test('a drag across a turned view moves what it carries the way the hand went', () => {
    const { effects } = play(
      [
        down({ hit: hit({ node: 'a' }) }),
        { kind: 'move', id: 1, at: HERE, screen: { x: 40, y: 0 }, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: HERE, screen: { x: 40, y: 0 }, hit: NOTHING },
      ],
      context({ turn: Math.PI / 2 }),
    )
    const move = effects.find((one) => one.do === 'move')
    expect(move).toMatchObject({ do: 'move' })
    if (move?.do !== 'move') return
    expect(move.dx).toBeCloseTo(0)
    expect(move.dy).toBeCloseTo(-40)
  })
})

describe('a pointer the system takes back', () => {
  const where = context()
  const move = (id: number, x: number): Input => ({
    kind: 'move',
    id,
    at: { x, y: 0 },
    screen: { x, y: 0 },
    samples: [],
    hit: NOTHING,
  })

  test('ends the gesture it was driving', () => {
    const { machine } = play(
      [down({ id: 2, pointer: 'touch', hit: hit({ node: 'a' }) }), { kind: 'cancel', id: 2 }],
      where,
    )

    expect(machine.gesture).toBeNull()
  })

  test('leaves the gesture another pointer is driving, as iPadOS takes back a palm', () => {
    const { machine, effects } = play(
      [
        down({ id: 2, pointer: 'touch', hit: hit({ node: 'a' }) }),
        { kind: 'cancel', id: 7 },
        move(2, 50),
        { kind: 'up', id: 2, at: { x: 50, y: 0 }, screen: { x: 50, y: 0 }, hit: NOTHING },
      ],
      where,
    )

    expect(machine.gesture).toBeNull()
    expect(effects.filter((one) => one.do === 'move')).toEqual([
      { do: 'move', ids: ['a'], dx: 50, dy: 0 },
    ])
  })
})

describe('palm rejection', () => {
  test('a finger is ignored while a pen is on the glass', () => {
    const pen = play([down({ id: 1, pointer: 'pen' })], context({ tool: 'draw' }))
    expect(pen.machine.penDown).toBe(true)

    const palm = step(pen.machine, down({ id: 2, pointer: 'touch' }), context({ tool: 'draw' }))
    expect(palm.machine.gesture).toBe(pen.machine.gesture)
    expect(palm.effects).toEqual([])
  })

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

  test('a pen arriving takes the glass from a palm that got there first', () => {
    const where = context({ tool: 'draw', penSeen: true })
    const palm = play([down({ id: 1, pointer: 'touch' })], where)
    expect(palm.machine.gesture?.kind).toBe('pan')

    const pen = step(palm.machine, down({ id: 2, pointer: 'pen' }), where)

    expect(pen.machine.gesture?.kind).toBe('draw')
    expect(pen.machine.driver?.id).toBe(2)
    expect(pen.machine.penDown).toBe(true)

    const dragged = step(
      pen.machine,
      { kind: 'move', id: 1, at: HERE, screen: { x: 90, y: 0 }, samples: [], hit: NOTHING },
      where,
    )
    expect(dragged.effects).toEqual([])
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

describe('a finger on a device that has a pen', () => {
  const INK = ['draw', 'erase', 'lasso'] as const
  const tablet = (over: Partial<Context> = {}) => context({ penSeen: true, ...over })

  test('pans the plane rather than drawing on it, whichever ink tool is in hand', () => {
    for (const tool of INK) {
      const { machine, effects } = play([down({ pointer: 'touch' })], tablet({ tool }))

      expect(machine.gesture?.kind, tool).toBe('pan')
      expect(verbs(effects), tool).toEqual(['leave'])
    }
  })

  test('picks a card and carries it, whichever ink tool is in hand', () => {
    for (const tool of INK) {
      const { machine, effects } = play(
        [down({ pointer: 'touch', hit: hit({ node: 'a' }) })],
        tablet({ tool }),
      )

      expect(machine.gesture, tool).toMatchObject({ kind: 'drag', ids: ['a'] })
      expect(verbs(effects), tool).toEqual(['leave', 'pick'])
    }
  })

  test('tapped on the plane and lifted clears what was picked', () => {
    const { effects } = play(
      [down({ pointer: 'touch' }), { kind: 'up', id: 1, at: HERE, screen: HERE, hit: NOTHING }],
      tablet({ tool: 'draw', picked: ['a'] }),
    )

    expect(verbs(effects)).toEqual(['leave', 'clear'])
  })

  test('two of them pinch, with an ink tool in hand as with the arrow', () => {
    const { machine } = play(
      [
        down({ id: 1, pointer: 'touch', screen: { x: 0, y: 0 } }),
        down({ id: 2, pointer: 'touch', screen: { x: 100, y: 0 } }),
      ],
      tablet({ tool: 'draw' }),
    )

    expect(machine.gesture).toMatchObject({ kind: 'pinch', apart: 100 })
  })

  test('held on the plane asks for the menu, with an ink tool in hand', () => {
    const { effects } = play(
      [down({ pointer: 'touch' }), { kind: 'held', at: { x: 7, y: 8 } }],
      tablet({ tool: 'draw' }),
    )

    expect(effects.at(-1)).toEqual({ do: 'menu', at: { x: 7, y: 8 } })
  })

  test('still places a card and drags out a shape', () => {
    const placed = play([down({ pointer: 'touch' })], tablet({ tool: 'text' }))
    expect(placed.machine.gesture).toMatchObject({ kind: 'pull', tool: 'text' })

    const shape = play([down({ pointer: 'touch' })], tablet({ tool: 'rect' }))
    expect(shape.machine.gesture).toMatchObject({ kind: 'pull', tool: 'rect' })
  })

  test('still pans with the hand tool', () => {
    const { machine } = play([down({ pointer: 'touch' })], tablet({ tool: 'hand' }))
    expect(machine.gesture?.kind).toBe('pan')
  })

  test('leaves the pen drawing, rubbing out and lassoing as before', () => {
    const drawn = play([down({ pointer: 'pen' })], tablet({ tool: 'draw' }))
    expect(drawn.machine.gesture?.kind).toBe('draw')

    const rubbed = play([down({ pointer: 'pen' })], tablet({ tool: 'erase' }))
    expect(rubbed.machine.gesture?.kind).toBe('erase')

    const caught = play([down({ pointer: 'pen' })], tablet({ tool: 'lasso' }))
    expect(caught.machine.gesture?.kind).toBe('lasso')
  })

  test('leaves the pen behaving as a mouse with the arrow', () => {
    const { machine } = play([down({ pointer: 'pen' })], tablet())
    expect(machine.gesture?.kind).toBe('band')
  })

  test('leaves the mouse alone', () => {
    for (const tool of INK) {
      const { machine } = play([down({ pointer: 'mouse' })], tablet({ tool }))
      expect(machine.gesture?.kind, tool).toBe(tool === 'erase' ? 'erase' : tool)
    }
  })

  test('draws again when the reader has asked for it', () => {
    const { machine } = play(
      [down({ pointer: 'touch' })],
      tablet({ tool: 'draw', fingerDraws: true }),
    )

    expect(machine.gesture?.kind).toBe('draw')
  })
})

describe('a finger on a device that has never seen a pen', () => {
  test('draws, rubs out and lassoes as before', () => {
    const drawn = play([down({ pointer: 'touch' })], context({ tool: 'draw' }))
    expect(drawn.machine.gesture?.kind).toBe('draw')

    const rubbed = play([down({ pointer: 'touch' })], context({ tool: 'erase' }))
    expect(rubbed.machine.gesture?.kind).toBe('erase')

    const caught = play([down({ pointer: 'touch' })], context({ tool: 'lasso' }))
    expect(caught.machine.gesture?.kind).toBe('lasso')
  })

  test('still pans with the arrow, as it always did', () => {
    const { machine } = play([down({ pointer: 'touch' })], context())
    expect(machine.gesture?.kind).toBe('pan')
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

  test('a pen down and up in one place is a stroke of one point', () => {
    const { effects } = play(
      [down({ pointer: 'pen' }), { kind: 'up', id: 1, at: HERE, screen: HERE, hit: NOTHING }],
      where,
    )

    const strokes = effects.filter((one) => one.do === 'stroke')
    expect(strokes).toHaveLength(1)
    expect(strokes[0]?.do === 'stroke' && strokes[0].stroke.points).toHaveLength(1)
  })

  test('a held pen asks for its shape to be tidied', () => {
    const { effects } = play([down({ pointer: 'pen' }), { kind: 'held', at: HERE }], where)

    expect(verbs(effects)).toContain('assist')
  })

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

  test('rubs out as far as the eraser is lifted, where it lifts past the last move', () => {
    const { effects } = play(
      [
        down(),
        { kind: 'move', id: 1, at: { x: 5, y: 0 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: { x: 9, y: 0 }, screen: HERE, hit: NOTHING },
      ],
      context({ tool: 'erase' }),
    )

    expect(effects.at(-1)).toMatchObject({ do: 'cut', ats: [{ x: 9, y: 0 }] })
  })

  test('with shift it takes whole strokes instead, as far as the stroke eraser reaches', () => {
    const { effects } = play([down({ shift: true })], context({ tool: 'erase', scale: 2 }))

    expect(effects).toEqual([{ do: 'rub', ats: [HERE], reach: STROKE_RUB / 2 }])
  })

  test('takes whole strokes when the bar says so, with no key held', () => {
    const { effects } = play(
      [down({ hit: hit({ stroke: 's1' }) })],
      context({ tool: 'erase', eraser: { whole: true, size: RUB, stroke: 6 } }),
    )

    expect(effects).toEqual([{ do: 'rub', ats: [HERE], reach: 6 }])
  })

  test('reaches as far as the bar says, in plane units at this zoom', () => {
    const { effects } = play(
      [down()],
      context({ tool: 'erase', eraser: { whole: false, size: 48, stroke: STROKE_RUB }, scale: 2 }),
    )

    expect(effects).toEqual([{ do: 'cut', ats: [HERE], reach: 24 }])
  })

  test('goes on reaching that far through the whole drag', () => {
    const { effects } = play(
      [
        down(),
        { kind: 'move', id: 1, at: { x: 5, y: 0 }, screen: HERE, samples: [], hit: NOTHING },
      ],
      context({ tool: 'erase', eraser: { whole: false, size: 30, stroke: STROKE_RUB }, scale: 1 }),
    )

    expect(effects).toEqual([
      { do: 'cut', ats: [HERE], reach: 30 },
      { do: 'cut', ats: [{ x: 5, y: 0 }], reach: 30 },
    ])
  })

  test('answers along the way it went between two events, not only at each, in one go', () => {
    const { effects } = play(
      [
        down(),
        {
          kind: 'move',
          id: 1,
          at: { x: 25, y: 0 },
          screen: { x: 25, y: 0 },
          samples: [],
          hit: NOTHING,
        },
      ],
      context({ tool: 'erase', eraser: { whole: false, size: 10, stroke: STROKE_RUB }, scale: 1 }),
    )

    expect(effects).toEqual([
      { do: 'cut', ats: [HERE], reach: 10 },
      {
        do: 'cut',
        ats: [5, 10, 15, 20, 25].map((x) => ({ x, y: 0 })),
        reach: 10,
      },
    ])
  })

  test('walks no way the plane moved by itself under a still hand', () => {
    const { effects } = play(
      [
        down(),
        {
          kind: 'move',
          id: 1,
          at: { x: 900, y: 0 },
          screen: { x: 1, y: 0 },
          samples: [],
          hit: NOTHING,
        },
      ],
      context({ tool: 'erase', eraser: { whole: false, size: 10, stroke: STROKE_RUB }, scale: 1 }),
    )

    expect(effects).toEqual([
      { do: 'cut', ats: [HERE], reach: 10 },
      { do: 'cut', ats: [{ x: 900, y: 0 }], reach: 10 },
    ])
  })

  test('walks the way a hand went at any zoom', () => {
    const { effects } = play(
      [
        down(),
        {
          kind: 'move',
          id: 1,
          at: { x: 10, y: 0 },
          screen: { x: 20, y: 0 },
          samples: [],
          hit: NOTHING,
        },
      ],
      context({ tool: 'erase', eraser: { whole: false, size: 10, stroke: STROKE_RUB }, scale: 2 }),
    )

    expect(effects.flatMap((one) => (one.do === 'cut' ? one.ats : []))).toHaveLength(5)
  })

  test('takes a whole line 8 px off under a finger, and not under a pen', () => {
    const line: InkStroke = {
      id: 's1',
      tool: 'pen',
      color: 'ink',
      size: 2,
      points: [0, 40].map((x) => ({ x, y: 8, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 })),
    }
    const reaches = (pointer: 'touch' | 'pen') =>
      play(
        [down({ pointer })],
        context({ tool: 'erase', eraser: { ...context().eraser, whole: true } }),
      ).effects.some(
        (one) => one.do === 'rub' && one.ats.some((at) => nearStroke(line, at, one.reach)),
      )

    expect(reaches('touch')).toBe(true)
    expect(reaches('pen')).toBe(false)
  })

  test('the pen button rubs the way the bar is set', () => {
    const { effects } = play(
      [down({ pointer: 'pen', eraser: true, hit: hit({ stroke: 's1' }) })],
      context({ tool: 'draw', eraser: { whole: true, size: RUB, stroke: 6 } }),
    )

    expect(effects).toEqual([{ do: 'rub', ats: [HERE], reach: 6 }])
  })
})

describe('the pen the bar is holding', () => {
  test('goes into the stroke whole, alpha and all', () => {
    const pen = { tool: 'highlighter', size: 18, color: '#ffcc00', opacity: 0.2 } as const
    const { machine } = play([down()], context({ tool: 'draw', pen }))

    expect(machine.gesture?.kind === 'draw' && machine.gesture.stroke).toMatchObject(pen)
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
  const PUT: Tool[] = [
    'text',
    'file',
    'picture',
    'link',
    'group',
    'rect',
    'ellipse',
    'rhombus',
    'triangle',
    'line',
    'arrow',
    'elbow',
  ]

  test('all of them are pulled out, so all of them can be drawn while they are', () => {
    for (const tool of PUT) {
      const { machine } = play([down({ at: { x: 30, y: 40 } })], context({ tool }))

      expect(machine.gesture, tool).toMatchObject({
        kind: 'pull',
        tool,
        from: { x: 30, y: 40 },
        to: { x: 30, y: 40 },
      })
    }
  })

  test('one nobody dragged lands at its own size where the press was', () => {
    for (const tool of PUT) {
      const { effects } = play(
        [
          down({ at: { x: 30, y: 40 } }),
          { kind: 'up', id: 1, at: HERE, screen: HERE, hit: NOTHING },
        ],
        context({ tool }),
      )

      expect(effects.at(-1), tool).toEqual({ do: 'place', tool, at: { x: 30, y: 40 } })
    }
  })

  test('one that was dragged lands at the size it was dragged to, once, on the way up', () => {
    const { effects } = play(
      [
        down({ at: { x: 0, y: 0 } }),
        { kind: 'move', id: 1, at: { x: 60, y: 40 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: { x: 60, y: 40 }, screen: HERE, hit: NOTHING },
      ],
      context({ tool: 'rect' }),
    )

    expect(effects.at(-1)).toEqual({
      do: 'pull',
      tool: 'rect',
      from: { x: 0, y: 0 },
      to: { x: 60, y: 40 },
    })
  })

  test('a card is drawn at the size it is being dragged to, while it is being dragged', () => {
    const { machine } = play(
      [
        down({ at: { x: 0, y: 0 } }),
        { kind: 'move', id: 1, at: { x: 200, y: 90 }, screen: HERE, samples: [], hit: NOTHING },
      ],
      context({ tool: 'text' }),
    )

    expect(machine.gesture).toMatchObject({ kind: 'pull', to: { x: 200, y: 90 } })
  })

  test('a line dragged from one card to another becomes a connector', () => {
    for (const [tool, head] of [
      ['line', false],
      ['arrow', true],
      ['elbow', false],
    ] as const) {
      const { effects } = play(
        [
          down({ at: { x: 0, y: 0 }, hit: hit({ node: 'a' }) }),
          {
            kind: 'move',
            id: 1,
            at: { x: 300, y: 200 },
            screen: HERE,
            samples: [],
            hit: hit({ node: 'b' }),
          },
          {
            kind: 'up',
            id: 1,
            at: { x: 300, y: 200 },
            screen: HERE,
            hit: hit({ node: 'b' }),
          },
        ],
        context({ tool }),
      )

      expect(effects.at(-1), tool).toEqual({
        do: 'connect',
        from: 'a',
        fromSide: 'right',
        to: 'b',
        toSide: 'auto',
        head,
      })
    }
  })

  test('a line dragged from a card to nowhere is a line', () => {
    const { effects } = play(
      [
        down({ at: { x: 0, y: 0 }, hit: hit({ node: 'a' }) }),
        { kind: 'move', id: 1, at: { x: 300, y: 20 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: { x: 300, y: 20 }, screen: HERE, hit: NOTHING },
      ],
      context({ tool: 'arrow' }),
    )

    expect(effects.at(-1)).toMatchObject({ do: 'pull', tool: 'arrow' })
  })

  test('a box dragged out on the plane is a box, not a connector', () => {
    const { effects } = play(
      [
        down({ at: { x: 0, y: 0 }, hit: hit({ node: 'a' }) }),
        {
          kind: 'move',
          id: 1,
          at: { x: 300, y: 200 },
          screen: HERE,
          samples: [],
          hit: hit({ node: 'b' }),
        },
        { kind: 'up', id: 1, at: { x: 300, y: 200 }, screen: HERE, hit: hit({ node: 'b' }) },
      ],
      context({ tool: 'rect' }),
    )

    expect(effects.at(-1)).toMatchObject({ do: 'pull', tool: 'rect' })
  })
})

describe('moving an end of a connector', () => {
  test('takes it to whatever card it was dropped on', () => {
    const { effects } = play(
      [
        down({ hit: hit({ endpoint: { id: 'e', end: 'to' } }) }),
        { kind: 'move', id: 1, at: { x: 90, y: 90 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: { x: 90, y: 90 }, screen: HERE, hit: hit({ node: 'c' }) },
      ],
      context({ picked: ['e'] }),
    )

    expect(effects.at(-1)).toEqual({ do: 'reconnect', edge: 'e', end: 'to', to: 'c' })
  })

  test('leaves it where it was when it was dropped on nothing', () => {
    const { effects } = play(
      [
        down({ hit: hit({ endpoint: { id: 'e', end: 'from' } }) }),
        { kind: 'up', id: 1, at: HERE, screen: HERE, hit: NOTHING },
      ],
      context({ picked: ['e'] }),
    )

    expect(effects).toEqual([])
  })
})

describe('alt on a drag', () => {
  test('leaves a copy where the drag began and carries the originals off', () => {
    const { machine, effects } = play(
      [down({ alt: true, hit: hit({ node: 'a' }) })],
      context({ picked: ['a'] }),
    )

    expect(verbs(effects)).toEqual(['leave', 'clone'])
    expect(machine.gesture).toMatchObject({ kind: 'drag', ids: ['a'] })
  })

  test('does nothing without alt', () => {
    const { effects } = play([down({ hit: hit({ node: 'a' }) })], context({ picked: ['a'] }))
    expect(verbs(effects)).toEqual(['leave'])
  })
})

describe('holding the shape of what is resized', () => {
  const box = { x: 0, y: 0, width: 100, height: 50 }

  test('is what Shift asks for', () => {
    const { machine } = play(
      [down({ shift: true, hit: hit({ handle: 'se' }) })],
      context({ picked: ['a'], inkBox: box }),
    )

    expect(machine.gesture).toMatchObject({ kind: 'resize', aspect: true })
  })

  test('is what a picture gets from a corner without being asked', () => {
    for (const handle of ['nw', 'ne', 'se', 'sw'] as const) {
      const { machine } = play(
        [down({ hit: hit({ handle }) })],
        context({ picked: ['a'], aspect: true }),
      )

      expect(machine.gesture).toMatchObject({ kind: 'resize', aspect: true })
    }
  })

  test('a picture pulled by a side stretches one way only', () => {
    for (const handle of ['n', 'e', 's', 'w'] as const) {
      const { machine } = play(
        [down({ hit: hit({ handle }) })],
        context({ picked: ['a'], aspect: true }),
      )

      expect(machine.gesture).toMatchObject({ kind: 'resize', aspect: false })
    }
  })

  test('Shift lets the corner of a picture pull it out of shape', () => {
    const { machine } = play(
      [down({ shift: true, hit: hit({ handle: 'se' }) })],
      context({ picked: ['a'], aspect: true }),
    )

    expect(machine.gesture).toMatchObject({ kind: 'resize', aspect: false })
  })

  test('is not what anything else gets', () => {
    const { machine } = play([down({ hit: hit({ handle: 'se' }) })], context({ picked: ['a'] }))
    expect(machine.gesture).toMatchObject({ kind: 'resize', aspect: false })
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

describe('a second finger', () => {
  const nib = { x: 0, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }

  const second = (over: Partial<Down> = {}): Down =>
    down({ id: 2, pointer: 'touch', screen: { x: 100, y: 0 }, time: 40, ...over })

  test('takes over a card the first one was carrying', () => {
    const { machine } = play(
      [down({ id: 1, pointer: 'touch', hit: hit({ node: 'a' }) }), second()],
      context({ penSeen: true }),
    )

    expect(machine.gesture).toMatchObject({ kind: 'pinch', ids: [1, 2], apart: 100 })
  })

  test('takes over a shape being dragged out', () => {
    const { machine } = play(
      [down({ id: 1, pointer: 'touch' }), second()],
      context({ tool: 'rect' }),
    )

    expect(machine.gesture?.kind).toBe('pinch')
  })

  test('gives up a stroke a moment old and takes the plane', () => {
    const { machine, effects } = play(
      [down({ id: 1, pointer: 'touch', sample: nib }), second()],
      context({ tool: 'draw' }),
    )

    expect(machine.gesture?.kind).toBe('pinch')
    expect(verbs(effects)).toEqual(['leave'])
  })

  test('leaves a stroke that is already under way alone', () => {
    const { machine } = play(
      [
        down({ id: 1, pointer: 'touch', sample: nib }),
        {
          kind: 'move',
          id: 1,
          at: { x: 9, y: 9 },
          screen: { x: 9, y: 9 },
          samples: [nib],
          hit: NOTHING,
        },
        second({ time: 900 }),
      ],
      context({ tool: 'draw' }),
    )

    expect(machine.gesture?.kind).toBe('draw')
    expect(machine.spare).toHaveLength(1)
  })

  test('pinches from where the first finger has got to, not from where it landed', () => {
    const { machine } = play(
      [
        down({ id: 1, pointer: 'touch', screen: { x: 0, y: 0 } }),
        { kind: 'move', id: 1, at: HERE, screen: { x: 40, y: 0 }, samples: [], hit: NOTHING },
        second({ screen: { x: 140, y: 0 } }),
      ],
      context(),
    )

    expect(machine.gesture).toMatchObject({ kind: 'pinch', apart: 100 })
  })

  test('takes back what the eraser rubbed out a moment before it, and takes the plane', () => {
    const { machine, effects } = play(
      [down({ id: 1, pointer: 'touch', hit: hit({ stroke: 's1' }) }), second()],
      context({ tool: 'erase' }),
    )

    expect(machine.gesture?.kind).toBe('pinch')
    expect(verbs(effects).slice(-1)).toEqual(['unrub'])
  })

  test('takes back what a finger rubbed out when the pen comes down and takes over', () => {
    const { machine, effects } = play(
      [
        down({ id: 1, pointer: 'touch', hit: hit({ stroke: 's1' }) }),
        down({ id: 2, pointer: 'pen', time: 900 }),
      ],
      context({ tool: 'erase', penSeen: true, fingerDraws: true }),
    )

    expect(machine.driver?.kind).toBe('pen')
    expect(verbs(effects)).toContain('unrub')
    expect(verbs(effects).indexOf('unrub')).toBeLessThan(verbs(effects).lastIndexOf('cut'))
  })

  test('takes back what a finger rubbed out when the system cancels the touch', () => {
    const { machine, effects } = play(
      [down({ id: 1, pointer: 'touch', hit: hit({ stroke: 's1' }) }), { kind: 'cancel', id: 1 }],
      context({ tool: 'erase' }),
    )

    expect(machine.gesture).toBeNull()
    expect(verbs(effects).slice(-1)).toEqual(['unrub'])
  })

  test('keeps what the pen rubbed out when its touch is cancelled', () => {
    const { effects } = play(
      [down({ id: 1, pointer: 'pen', hit: hit({ stroke: 's1' }) }), { kind: 'cancel', id: 1 }],
      context({ tool: 'erase' }),
    )

    expect(verbs(effects)).not.toContain('unrub')
  })

  test('keeps what the pen rubbed out when the pen comes down again', () => {
    const { effects } = play(
      [
        down({ id: 1, pointer: 'pen', hit: hit({ stroke: 's1' }) }),
        down({ id: 2, pointer: 'pen', time: 900 }),
      ],
      context({ tool: 'erase' }),
    )

    expect(verbs(effects)).not.toContain('unrub')
  })

  test('is a palm rather than a pinch once the eraser has begun rubbing out', () => {
    const { machine } = play(
      [down({ id: 1, pointer: 'touch' }), second({ time: 900 })],
      context({ tool: 'erase' }),
    )

    expect(machine.gesture?.kind).toBe('erase')
  })
})

describe('the pen with its button held', () => {
  test('rubs out where Chromium reports the right button', () => {
    const { machine, effects } = play(
      [down({ pointer: 'pen', button: 2, eraser: true, hit: hit({ stroke: 's1' }) })],
      context({ tool: 'draw' }),
    )

    expect(machine.gesture?.kind).toBe('erase')
    expect(verbs(effects)).toEqual(['cut'])
  })

  test('takes a whole stroke where the bar says whole strokes', () => {
    const { effects } = play(
      [down({ pointer: 'pen', button: 2, eraser: true, hit: hit({ stroke: 's1' }) })],
      context({ tool: 'draw', eraser: { whole: true, size: RUB, stroke: 6 } }),
    )

    expect(effects).toEqual([{ do: 'rub', ats: [HERE], reach: 6 }])
  })

  test('asks for no menu, which belongs to the mouse', () => {
    const { effects } = play([down({ pointer: 'pen', button: 2, eraser: true })], context())

    expect(verbs(effects)).not.toContain('menu')
  })

  test('leaves the right button on a mouse opening the menu', () => {
    const { effects } = play([down({ pointer: 'mouse', button: 2 })], context())

    expect(verbs(effects)).toEqual(['menu'])
  })
})

describe('a contact that turns out to be a pen', () => {
  const nib = { x: 3, y: 4, pressure: 0.7, tiltX: 1, tiltY: -1, t: 0 }
  const penned = {
    kind: 'penned',
    id: 1,
    at: { x: 3, y: 4 },
    sample: nib,
    eraser: false,
    hit: NOTHING,
  } as const

  test('draws from where the nib landed rather than panning', () => {
    const { machine } = play(
      [down({ pointer: 'touch' }), penned],
      context({ tool: 'draw', penSeen: true }),
    )

    expect(machine.gesture).toMatchObject({ kind: 'draw' })
    expect(machine.gesture?.kind === 'draw' && machine.gesture.stroke.points).toEqual([nib])
    expect(machine.penDown).toBe(true)
  })

  test('rubs out when the button was late', () => {
    const { machine, effects } = play(
      [down({ pointer: 'pen', sample: nib }), { ...penned, eraser: true }],
      context({ tool: 'draw' }),
    )

    expect(machine.gesture?.kind).toBe('erase')
    expect(verbs(effects)).toEqual(['leave', 'cut'])
  })

  test('leaves a stroke that is already drawing where it is', () => {
    const { machine } = play(
      [
        down({ pointer: 'pen', sample: nib }),
        { kind: 'move', id: 1, at: { x: 9, y: 9 }, screen: HERE, samples: [nib], hit: NOTHING },
        penned,
      ],
      context({ tool: 'draw' }),
    )

    expect(machine.gesture?.kind === 'draw' && machine.gesture.stroke.points).toHaveLength(2)
  })

  test('turns a stroke that is already drawing into a rub when the button comes down', () => {
    const { machine, effects } = play(
      [
        down({ pointer: 'pen', sample: nib }),
        { kind: 'move', id: 1, at: { x: 9, y: 9 }, screen: HERE, samples: [nib], hit: NOTHING },
        { ...penned, eraser: true },
      ],
      context({ tool: 'draw' }),
    )

    expect(machine.gesture?.kind).toBe('erase')
    expect(verbs(effects)).toEqual(['leave', 'cut'])
  })

  test('takes the whole stroke it lands on when the eraser is set that way', () => {
    const { effects } = play(
      [
        down({ pointer: 'pen', sample: nib }),
        { kind: 'move', id: 1, at: { x: 9, y: 9 }, screen: HERE, samples: [nib], hit: NOTHING },
        { ...penned, eraser: true, hit: hit({ stroke: 's1' }) },
      ],
      context({ tool: 'draw', eraser: { whole: true, size: RUB, stroke: 6 } }),
    )

    expect(effects.at(-1)).toEqual({ do: 'rub', ats: [penned.at], reach: 6 })
  })

  test('leaves a plane that has been panned where the hand put it', () => {
    const { machine } = play(
      [
        down({ pointer: 'touch' }),
        { kind: 'move', id: 1, at: HERE, screen: { x: 80, y: 0 }, samples: [], hit: NOTHING },
        penned,
      ],
      context({ tool: 'draw', penSeen: true }),
    )

    expect(machine.gesture?.kind).toBe('pan')
  })

  test('says nothing about a pointer that is not the one driving the gesture', () => {
    const { machine } = play(
      [down({ pointer: 'touch' }), { ...penned, id: 7 }],
      context({ tool: 'draw', penSeen: true }),
    )

    expect(machine.gesture?.kind).toBe('pan')
  })
})

describe('the lasso pulled out as a box', () => {
  const where = context({ tool: 'lasso', lassoBox: true })

  test('is the four corners of the box, so what draws it and what reads it agree', () => {
    const { machine } = play(
      [
        down({ at: { x: 0, y: 0 } }),
        { kind: 'move', id: 1, at: { x: 10, y: 6 }, screen: HERE, samples: [], hit: NOTHING },
      ],
      where,
    )

    expect(machine.gesture?.kind === 'lasso' && machine.gesture.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ])
  })

  test('catches what the box went round when it is let go', () => {
    const { effects } = play(
      [
        down({ at: { x: 0, y: 0 } }),
        { kind: 'move', id: 1, at: { x: 10, y: 6 }, screen: HERE, samples: [], hit: NOTHING },
        { kind: 'up', id: 1, at: { x: 10, y: 6 }, screen: HERE, hit: NOTHING },
      ],
      where,
    )

    expect(effects.at(-1)).toMatchObject({ do: 'catch' })
  })
})

describe('straightening what was drawn', () => {
  test('is what a held stroke asks for when the pen has been told to', () => {
    const { effects } = play(
      [down({ pointer: 'pen' }), { kind: 'held', at: HERE }],
      context({ tool: 'draw', straighten: true }),
    )

    expect(verbs(effects)).toContain('assist')
  })

  test('is left alone when it has not', () => {
    const { effects } = play(
      [down({ pointer: 'pen' }), { kind: 'held', at: HERE }],
      context({ tool: 'draw', straighten: false }),
    )

    expect(verbs(effects)).not.toContain('assist')
  })

  test('is not the menu, whatever a pen is holding', () => {
    const spacing = step(start(), { kind: 'space', down: true }, context()).machine
    const { effects } = play(
      [down({ pointer: 'pen' }), { kind: 'held', at: HERE }],
      context(),
      spacing,
    )

    expect(verbs(effects)).not.toContain('menu')
  })
})

describe('a finger held on the bare plane, then moved', () => {
  const at = (x: number, y: number) => ({ x, y })
  const move = (x: number, y: number): Input => ({
    kind: 'move',
    id: 1,
    at: at(x, y),
    screen: at(x, y),
    samples: [],
    hit: NOTHING,
  })

  test('puts the menu away and draws a lasso from where it was held', () => {
    const { machine, effects } = play(
      [
        down({ pointer: 'touch', at: at(10, 10), screen: at(10, 10) }),
        { kind: 'held', at: at(10, 10) },
        move(40, 10),
        move(40, 40),
        move(10, 40),
      ],
      context(),
    )
    expect(verbs(effects)).toEqual(['leave', 'menu', 'unmenu'])
    expect(machine.gesture).toMatchObject({
      kind: 'lasso',
      cards: true,
      points: [at(10, 10), at(40, 10), at(40, 40), at(10, 40)],
    })
  })

  test('and let go, catches what the loop goes round, cards as well', () => {
    const { effects } = play(
      [
        down({ pointer: 'touch', at: at(10, 10), screen: at(10, 10) }),
        { kind: 'held', at: at(10, 10) },
        move(40, 10),
        move(40, 40),
        { kind: 'up', id: 1, at: at(10, 40), screen: at(10, 40), hit: NOTHING },
      ],
      context(),
    )
    expect(effects.at(-1)).toMatchObject({ do: 'catch', cards: true })
  })

  test('let go where it was held, leaves the menu up and draws nothing', () => {
    const { machine, effects } = play(
      [
        down({ pointer: 'touch', at: at(10, 10), screen: at(10, 10) }),
        { kind: 'held', at: at(10, 10) },
        move(11, 10),
        { kind: 'up', id: 1, at: at(11, 10), screen: at(11, 10), hit: NOTHING },
      ],
      context(),
    )
    expect(verbs(effects)).toEqual(['leave', 'menu'])
    expect(machine.gesture).toBeNull()
  })

  test('a finger that moved at once moves the plane, as it always has', () => {
    const { effects } = play(
      [down({ pointer: 'touch', at: at(10, 10), screen: at(10, 10) }), move(60, 10)],
      context(),
    )
    expect(verbs(effects)).toContain('pan')
  })

  test('a finger held on a card still only asks for the menu', () => {
    const { machine, effects } = play(
      [
        down({ pointer: 'touch', hit: hit({ node: 'a' }) }),
        { kind: 'held', at: at(7, 8) },
        move(80, 80),
      ],
      context(),
    )
    expect(effects).toContainEqual({ do: 'menu', at: at(7, 8) })
    expect(verbs(effects)).not.toContain('unmenu')
    expect(machine.gesture?.kind).not.toBe('lasso')
  })
})
