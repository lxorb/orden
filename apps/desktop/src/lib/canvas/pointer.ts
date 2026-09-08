/** What a press, a drag and a lift mean, as one machine over events.
 *
 *  Every gesture the plane has lives here and nowhere else: picking, banding,
 *  dragging, resizing, connecting, panning, pinching, drawing, rubbing out and
 *  lassoing. The surface next door does three things and no more - it works out
 *  what is under a point, it hands the machine the event, and it carries out the
 *  effects it gets back. That is why this file has no DOM in it and every rule in
 *  it is a test rather than a thing to try with a mouse.
 *
 *  A hit is part of the event rather than something the machine goes and asks
 *  for. Hit testing needs the plane, the camera and the z order; keeping it out
 *  here is what makes a gesture a sequence of values, and a sequence of values is
 *  something a test can write down.
 *
 *  Nothing here touches the document. The machine says "these cards moved by
 *  this much"; the store decides what that is worth remembering. A gesture is one
 *  edit because the machine only ever says so once, when the pointer comes up. */

import type { InkPoint, InkTool, Shape, Side } from './format'
import type { Box, HandleId, Point } from './geometry'

/** What the bar is set to. The arrow is the one everything else falls back to;
 *  the last four are the shapes, which the format already names. */
export type Tool =
  'select' | 'hand' | 'draw' | 'erase' | 'lasso' | 'text' | 'file' | 'link' | 'group' | Shape

type PointerKind = 'mouse' | 'pen' | 'touch'

/** What the pointer landed on, worked out by the surface before the event gets
 *  here. Everything is a name rather than an object, so a machine state can be
 *  compared with `toEqual` and a test needs no canvas to write one down. */
export interface Hit {
  /** A resize handle of what is picked. */
  handle: HandleId | null
  /** One of the four dots an edge is dragged from. */
  port: { id: string; side: Side } | null
  /** The card under the point, if any. */
  node: string | null
  /** The connector under the point, if any. */
  edge: string | null
  /** The ink stroke under the point, if any. */
  stroke: string | null
  /** A handle of the lasso's own box: a corner to pull, or its ring to turn by. */
  ink: HandleId | 'turn' | 'inside' | null
}

export const NOTHING: Hit = {
  handle: null,
  port: null,
  node: null,
  edge: null,
  stroke: null,
  ink: null,
}

/** What the surface knows when the pointer goes down, beyond where it is. */
export interface Down {
  kind: 'down'
  id: number
  pointer: PointerKind
  /** Where on the plane, and where on the screen. Panning and pinching are
   *  screen arithmetic; everything else is plane arithmetic. */
  at: Point
  screen: Point
  /** The mouse button, or 0 for a pen and a finger. */
  button: number
  /** Shift, and the "as well as" key, which is Ctrl or Cmd. */
  shift: boolean
  adds: boolean
  /** The pen held with its button down, or turned over. Rubs out whatever the
   *  bar is set to, which is what every stylus does. */
  eraser: boolean
  /** What the pen reported, for the first point of a stroke. */
  sample: InkPoint
  hit: Hit
}

interface Move {
  kind: 'move'
  id: number
  at: Point
  screen: Point
  /** Every sample since the last event, oldest first, which is what
   *  `getCoalescedEvents` hands over: a fast stroke is drawn through all of them
   *  rather than through the one that happened to be delivered. */
  samples: InkPoint[]
  hit: Hit
}

export type Input =
  | Down
  | Move
  | { kind: 'up'; id: number; at: Point; screen: Point; hit: Hit }
  | { kind: 'cancel'; id: number }
  | { kind: 'space'; down: boolean }
  /** The pointer has been still long enough to mean something: a menu under a
   *  finger, a tidied shape under a pen. */
  | { kind: 'held'; at: Point }

/** What the machine asks the surface to do. Named as verbs because that is what
 *  they are; the surface carries them out in order and none of them can fail. */
export type Effect =
  | { do: 'pick'; ids: string[]; adding: boolean }
  | { do: 'clear' }
  | { do: 'edit'; id: string }
  | { do: 'leave' }
  | { do: 'move'; ids: string[]; dx: number; dy: number }
  | { do: 'resize'; ids: string[]; handle: HandleId; dx: number; dy: number }
  /** `auto` lets the store work the far side out from where the two cards
   *  ended up, which is what a hand dropping a line on a card means. */
  | { do: 'connect'; from: string; fromSide: Side; to: string; toSide: Side | 'auto' }
  | { do: 'shape'; tool: Shape; from: Point; to: Point }
  | { do: 'place'; tool: Tool; at: Point }
  | { do: 'stroke'; stroke: PendingStroke }
  | { do: 'rub'; ids: string[] }
  | { do: 'cut'; at: Point; reach: number }
  | { do: 'catch'; lasso: Point[] }
  | { do: 'ink'; dx: number; dy: number; scale: number; turn: number; about: Point }
  | { do: 'pan'; dx: number; dy: number }
  | { do: 'zoom'; at: Point; by: number }
  | { do: 'menu'; at: Point }
  | { do: 'assist' }

/** A stroke while it is being drawn: everything but an id, which the store hands
 *  out when it takes it. */
export interface PendingStroke {
  tool: InkTool
  size: number
  color: string
  points: InkPoint[]
}

type Gesture =
  | { kind: 'pan'; id: number; screen: Point; moved: boolean }
  | { kind: 'pinch'; ids: [number, number]; screens: [Point, Point]; apart: number }
  | { kind: 'drag'; ids: string[]; screen: Point; dx: number; dy: number }
  | { kind: 'resize'; ids: string[]; handle: HandleId; screen: Point; dx: number; dy: number }
  | { kind: 'band'; from: Point; to: Point; was: string[]; adding: boolean }
  | { kind: 'connect'; id: string; side: Side; to: Point }
  | { kind: 'shape'; tool: Shape; from: Point; to: Point }
  | { kind: 'draw'; stroke: PendingStroke; id: number }
  | { kind: 'erase'; whole: boolean; hit: string[]; id: number }
  | { kind: 'lasso'; points: Point[] }
  | { kind: 'ink'; how: 'move' | HandleId | 'turn'; box: Box; from: Point }

export interface Machine {
  gesture: Gesture | null
  /** Which pointer the gesture belongs to. A palm coming off the glass must not
   *  end the stroke the pen is still drawing, and a second finger lifting must
   *  not end a pan the first is still driving. */
  driving: number | null
  /** Space held, which turns any drag into a pan. */
  spacing: boolean
  /** Whether a pen is on the glass. Every finger is ignored while it is, which
   *  is the whole of palm rejection: a hand resting on a tablet is touch, and a
   *  pen that has arrived means the hand is not what anybody is drawing with. */
  penDown: boolean
  /** Fingers down that are not driving the gesture, so the second one can start
   *  a pinch and the first can carry on. */
  spare: { id: number; screen: Point }[]
  /** The card the pointer is over, which wears the four dots. */
  hovered: string | null
}

export function start(): Machine {
  return { gesture: null, driving: null, spacing: false, penDown: false, spare: [], hovered: null }
}

/** How far a pointer may travel and still count as a press rather than a drag,
 *  in plane units at one to one. */
const SLOP = 3

/** How wide the eraser is, in plane units. */
const RUB = 10

export interface Step {
  machine: Machine
  effects: Effect[]
}

/** What the surface has to tell the machine that is not in the event: which tool
 *  the bar is on, what is picked, and how big a plane unit is on screen. */
export interface Context {
  tool: Tool
  picked: string[]
  /** Whether a card is being written in, which suspends every gesture over it. */
  editing: string | null
  /** Pixels per plane unit. Slop and the eraser are felt in pixels. */
  scale: number
  /** The box round the ink a lasso caught, when there is one. */
  inkBox: Box | null
  /** The pen as the bar has it set. */
  pen: { tool: InkTool; size: number; color: string }
}

/** One event. The machine and the effects, never a change in place: a reducer
 *  that hands back a new value is one a test can compare. */
export function step(machine: Machine, input: Input, context: Context): Step {
  switch (input.kind) {
    case 'space':
      return { machine: { ...machine, spacing: input.down }, effects: [] }
    case 'down':
      return onDown(machine, input, context)
    case 'move':
      return onMove(machine, input, context)
    case 'up':
      return onUp(machine, input, context)
    case 'cancel':
      return {
        machine: { ...machine, gesture: null, spare: [], penDown: false, driving: null },
        effects: [],
      }
    case 'held':
      return onHeld(machine, input.at)
  }
}

function onDown(machine: Machine, input: Down, context: Context): Step {
  // A hand resting on the glass while the pen is on it is a hand, not a gesture.
  if (input.pointer === 'touch' && machine.penDown) return { machine, effects: [] }

  const penDown = machine.penDown || input.pointer === 'pen'

  // A second finger turns a pan into a pinch, which is the only two-pointer
  // gesture there is. A third is spare and changes nothing.
  if (input.pointer === 'touch' && machine.gesture) {
    const first = machine.gesture.kind === 'pan' ? machine.gesture : null
    if (first) {
      return {
        machine: {
          ...machine,
          penDown,
          gesture: {
            kind: 'pinch',
            ids: [first.id, input.id],
            screens: [first.screen, input.screen],
            apart: Math.hypot(input.screen.x - first.screen.x, input.screen.y - first.screen.y),
          },
        },
        effects: [],
      }
    }

    return {
      machine: {
        ...machine,
        penDown,
        spare: [...machine.spare, { id: input.id, screen: input.screen }],
      },
      effects: [],
    }
  }

  if (machine.gesture) return { machine: { ...machine, penDown }, effects: [] }

  const held = { ...machine, penDown, driving: input.id }

  // The right button is the menu's, wherever it lands. It starts nothing, so it
  // drives nothing either.
  if (input.button === 2) {
    return {
      machine: { ...held, driving: machine.driving },
      effects: [{ do: 'menu', at: input.at }],
    }
  }

  // Space, the middle button and the hand tool all pan, over a card as readily
  // as over the plane: a hand that has learned one of them uses it everywhere.
  if (machine.spacing || input.button === 1 || context.tool === 'hand') {
    return {
      machine: {
        ...held,
        gesture: { kind: 'pan', id: input.id, screen: input.screen, moved: false },
      },
      effects: [],
    }
  }

  // The pen's own button rubs out whatever the bar says, which is what a stylus
  // does in every app that has ever had one.
  if (input.eraser) {
    return {
      machine: { ...held, gesture: { kind: 'erase', whole: false, hit: [], id: input.id } },
      effects: [{ do: 'cut', at: input.at, reach: RUB / context.scale }],
    }
  }

  switch (context.tool) {
    case 'draw':
      return {
        machine: {
          ...held,
          gesture: {
            kind: 'draw',
            id: input.id,
            stroke: { ...context.pen, points: [input.sample] },
          },
        },
        effects: [{ do: 'leave' }],
      }
    case 'erase': {
      const whole = input.shift
      // What was rubbed is remembered, so dragging back over a stroke that has
      // already gone does not ask for it again.
      const first = whole && input.hit.stroke ? [input.hit.stroke] : []

      return {
        machine: { ...held, gesture: { kind: 'erase', whole, hit: first, id: input.id } },
        effects: whole
          ? first.length
            ? [{ do: 'rub', ids: first }]
            : []
          : [{ do: 'cut', at: input.at, reach: RUB / context.scale }],
      }
    }
    case 'lasso':
      // A press inside what the lasso already caught moves it; anywhere else
      // draws a new one.
      if (input.hit.ink) {
        return {
          machine: {
            ...held,
            gesture: {
              kind: 'ink',
              how: input.hit.ink === 'inside' ? 'move' : input.hit.ink,
              box: context.inkBox ?? { x: 0, y: 0, width: 0, height: 0 },
              from: input.at,
            },
          },
          effects: [],
        }
      }

      return { machine: { ...held, gesture: { kind: 'lasso', points: [input.at] } }, effects: [] }
    case 'text':
    case 'file':
    case 'link':
    case 'group':
      return {
        machine: { ...held, driving: machine.driving },
        effects: [{ do: 'place', tool: context.tool, at: input.at }],
      }
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return {
        machine: {
          ...held,
          gesture: { kind: 'shape', tool: context.tool, from: input.at, to: input.at },
        },
        effects: [],
      }
    case 'select':
      // The hand is not here: it panned above, from anywhere, which is what a
      // hand does. Only the arrow reaches the rest of this file.
      break
  }

  return select(held, input, context)
}

/** What a press means with the arrow: a handle, a dot, a connector, a card, or
 *  the plane. In that order, because that is the order they are drawn in. */
function select(machine: Machine, input: Down, context: Context): Step {
  const { hit } = input

  if (hit.handle && context.picked.length) {
    return {
      machine: {
        ...machine,
        gesture: {
          kind: 'resize',
          ids: [...context.picked],
          handle: hit.handle,
          screen: input.screen,
          dx: 0,
          dy: 0,
        },
      },
      effects: [],
    }
  }

  if (hit.port) {
    return {
      machine: {
        ...machine,
        gesture: { kind: 'connect', id: hit.port.id, side: hit.port.side, to: input.at },
      },
      effects: [],
    }
  }

  if (hit.edge) {
    return {
      machine,
      effects: [
        { do: 'pick', ids: [hit.edge], adding: input.adds || input.shift },
        { do: 'leave' },
      ],
    }
  }

  // A card being written in keeps the pointer: it is a text field, and a drag in
  // one selects words.
  if (context.editing !== null && hit.node === context.editing) {
    return { machine: { ...machine, driving: null }, effects: [] }
  }

  if (!hit.node) {
    // A finger on the plane moves the plane; there is no second button to pan
    // with and no marquee anybody draws with a thumb.
    if (input.pointer === 'touch') {
      return {
        machine: {
          ...machine,
          gesture: { kind: 'pan', id: input.id, screen: input.screen, moved: false },
        },
        effects: [{ do: 'leave' }],
      }
    }

    const adding = input.adds || input.shift
    return {
      machine: {
        ...machine,
        gesture: {
          kind: 'band',
          from: input.at,
          to: input.at,
          was: adding ? [...context.picked] : [],
          adding,
        },
      },
      effects: adding ? [{ do: 'leave' }] : [{ do: 'leave' }, { do: 'clear' }],
    }
  }

  const adding = input.adds || input.shift
  const effects: Effect[] = [{ do: 'leave' }]
  // A press on something already picked keeps the whole selection, so a drag of
  // nine cards is not undone by grabbing one of them.
  if (adding || !context.picked.includes(hit.node)) {
    effects.push({ do: 'pick', ids: [hit.node], adding })
  }

  const ids = adding
    ? // Whatever the pick just did, worked out here so the drag carries it.
      context.picked.includes(hit.node)
      ? context.picked.filter((one) => one !== hit.node)
      : [...context.picked, hit.node]
    : context.picked.includes(hit.node)
      ? [...context.picked]
      : [hit.node]

  if (!ids.length) return { machine: { ...machine, driving: null }, effects }

  return {
    machine: {
      ...machine,
      gesture: { kind: 'drag', ids, screen: input.screen, dx: 0, dy: 0 },
    },
    effects,
  }
}

function onMove(machine: Machine, input: Move, context: Context): Step {
  const one = machine.gesture

  if (!one) {
    const hovered = input.hit.node
    return {
      machine: hovered === machine.hovered ? machine : { ...machine, hovered },
      effects: [],
    }
  }

  switch (one.kind) {
    case 'pan': {
      if (input.id !== one.id) return { machine, effects: [] }

      const dx = input.screen.x - one.screen.x
      const dy = input.screen.y - one.screen.y

      return {
        machine: {
          ...machine,
          gesture: { ...one, screen: input.screen, moved: one.moved || Math.hypot(dx, dy) > SLOP },
        },
        effects: [{ do: 'pan', dx, dy }],
      }
    }

    case 'pinch': {
      const which = one.ids.indexOf(input.id)
      if (which < 0) return { machine, effects: [] }

      const screens: [Point, Point] =
        which === 0 ? [input.screen, one.screens[1]] : [one.screens[0], input.screen]
      const apart = Math.hypot(screens[1].x - screens[0].x, screens[1].y - screens[0].y)
      const middle = {
        x: (screens[0].x + screens[1].x) / 2,
        y: (screens[0].y + screens[1].y) / 2,
      }
      const was = {
        x: (one.screens[0].x + one.screens[1].x) / 2,
        y: (one.screens[0].y + one.screens[1].y) / 2,
      }

      const effects: Effect[] = [{ do: 'pan', dx: middle.x - was.x, dy: middle.y - was.y }]
      // Two fingers that stay the same distance apart are a pan, and a zoom of
      // exactly one is not worth a camera write.
      if (one.apart > 0 && Math.abs(apart - one.apart) > 0.5) {
        effects.push({ do: 'zoom', at: middle, by: apart / one.apart })
      }

      return { machine: { ...machine, gesture: { ...one, screens, apart } }, effects }
    }

    case 'drag':
    case 'resize':
      return {
        machine: {
          ...machine,
          gesture: {
            ...one,
            dx: (input.screen.x - one.screen.x) / context.scale,
            dy: (input.screen.y - one.screen.y) / context.scale,
          },
        },
        effects: [],
      }

    case 'band':
      return { machine: { ...machine, gesture: { ...one, to: input.at } }, effects: [] }

    case 'connect':
      return { machine: { ...machine, gesture: { ...one, to: input.at } }, effects: [] }

    case 'shape':
      return { machine: { ...machine, gesture: { ...one, to: input.at } }, effects: [] }

    case 'draw': {
      if (input.id !== one.id) return { machine, effects: [] }

      const points = input.samples.length ? input.samples : []
      if (!points.length) return { machine, effects: [] }

      return {
        machine: {
          ...machine,
          gesture: { ...one, stroke: { ...one.stroke, points: [...one.stroke.points, ...points] } },
        },
        effects: [],
      }
    }

    case 'erase': {
      if (input.id !== one.id) return { machine, effects: [] }

      if (!one.whole) {
        return { machine, effects: [{ do: 'cut', at: input.at, reach: RUB / context.scale }] }
      }

      if (!input.hit.stroke || one.hit.includes(input.hit.stroke)) return { machine, effects: [] }

      return {
        machine: { ...machine, gesture: { ...one, hit: [...one.hit, input.hit.stroke] } },
        effects: [{ do: 'rub', ids: [input.hit.stroke] }],
      }
    }

    case 'lasso':
      return {
        machine: { ...machine, gesture: { ...one, points: [...one.points, input.at] } },
        effects: [],
      }

    case 'ink':
      return { machine, effects: [inkEffect(one, input.at)] }
  }
}

/** What a drag of the lasso's box comes to: a move, a pull from one corner, or a
 *  turn about its middle. One effect either way, so the surface applies one
 *  transform and the store keeps one undo step. */
function inkEffect(one: Extract<Gesture, { kind: 'ink' }>, at: Point): Effect {
  const box = one.box
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  if (one.how === 'move') {
    return {
      do: 'ink',
      dx: at.x - one.from.x,
      dy: at.y - one.from.y,
      scale: 1,
      turn: 0,
      about: middle,
    }
  }

  if (one.how === 'turn') {
    const was = Math.atan2(one.from.y - middle.y, one.from.x - middle.x)
    const now = Math.atan2(at.y - middle.y, at.x - middle.x)
    return { do: 'ink', dx: 0, dy: 0, scale: 1, turn: now - was, about: middle }
  }

  // A corner scales about the middle, evenly on both axes: handwriting stretched
  // one way is handwriting nobody wrote.
  const reach = Math.max(box.width, box.height, 1) / 2
  const was = Math.hypot(one.from.x - middle.x, one.from.y - middle.y)
  const now = Math.hypot(at.x - middle.x, at.y - middle.y)
  const scale = was > reach * 0.1 ? Math.max(0.05, now / was) : 1

  return { do: 'ink', dx: 0, dy: 0, scale, turn: 0, about: middle }
}

function onUp(machine: Machine, input: Extract<Input, { kind: 'up' }>, context: Context): Step {
  const one = machine.gesture
  const spare = machine.spare.filter((held) => held.id !== input.id)

  if (!one) return { machine: { ...machine, spare, penDown: false, driving: null }, effects: [] }

  // A pinch that loses one finger goes back to panning with the other.
  if (one.kind === 'pinch' && one.ids.includes(input.id)) {
    const left = one.ids[0] === input.id ? 1 : 0
    return {
      machine: {
        ...machine,
        spare,
        driving: one.ids[left],
        gesture: { kind: 'pan', id: one.ids[left], screen: one.screens[left], moved: true },
      },
      effects: [],
    }
  }

  // Somebody else's pointer. A palm coming off the glass is not the pen putting
  // its stroke down, and a stray finger is not the end of a drag.
  if (machine.driving !== null && machine.driving !== input.id) {
    return { machine: { ...machine, spare }, effects: [] }
  }

  const rest: Machine = { ...machine, gesture: null, spare, penDown: false, driving: null }

  switch (one.kind) {
    case 'pan':
      // A finger that went down and came up without going anywhere is a tap on
      // the plane, and a tap on the plane means "nothing, thank you". A mouse
      // says the same thing the moment it is pressed; a finger cannot, because
      // the same press is how the plane is moved.
      return { machine: rest, effects: one.moved ? [] : [{ do: 'clear' }] }
    case 'pinch':
      return { machine: rest, effects: [] }

    case 'drag': {
      // A drag that was really a click has nothing to record.
      if (Math.hypot(one.dx, one.dy) * context.scale <= SLOP) return { machine: rest, effects: [] }
      return { machine: rest, effects: [{ do: 'move', ids: one.ids, dx: one.dx, dy: one.dy }] }
    }

    case 'resize': {
      if (Math.hypot(one.dx, one.dy) * context.scale <= SLOP) return { machine: rest, effects: [] }
      return {
        machine: rest,
        effects: [{ do: 'resize', ids: one.ids, handle: one.handle, dx: one.dx, dy: one.dy }],
      }
    }

    case 'band':
      return { machine: rest, effects: [] }

    case 'connect': {
      const target = input.hit.node
      if (!target || target === one.id) return { machine: rest, effects: [] }

      return {
        machine: rest,
        effects: [{ do: 'connect', from: one.id, fromSide: one.side, to: target, toSide: 'auto' }],
      }
    }

    case 'shape': {
      const span = Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y)
      if (span * context.scale <= SLOP) return { machine: rest, effects: [] }
      return {
        machine: rest,
        effects: [{ do: 'shape', tool: one.tool, from: one.from, to: one.to }],
      }
    }

    case 'draw': {
      if (one.stroke.points.length < 2) return { machine: rest, effects: [] }
      return { machine: rest, effects: [{ do: 'stroke', stroke: one.stroke }] }
    }

    case 'erase':
      return { machine: rest, effects: [] }

    case 'lasso':
      return { machine: rest, effects: [{ do: 'catch', lasso: one.points }] }

    case 'ink':
      return { machine: rest, effects: [] }
  }
}

/** The pointer has been still long enough to mean something. A finger asks for
 *  the menu; a pen that is still drawing asks for its shape to be tidied. */
function onHeld(machine: Machine, at: Point): Step {
  const one = machine.gesture
  if (!one) return { machine, effects: [] }

  if (one.kind === 'draw') return { machine, effects: [{ do: 'assist' }] }

  // A finger held on the plane or on a card is the menu, which is the only way
  // to reach one without a second mouse button.
  if (one.kind === 'pan' || one.kind === 'drag') {
    return { machine: { ...machine, gesture: null }, effects: [{ do: 'menu', at }] }
  }

  return { machine, effects: [] }
}
