import { settledTurn, TURN_DEADBAND, turnedBy } from '../camera'
import type { InkPoint, InkTool, Shape, Side } from './format'
import type { Box, HandleId, Point } from './geometry'
import { rubbedBetween } from './ink'

export type Tool = 'select' | 'hand' | 'draw' | 'erase' | 'lasso' | PutTool

export type PutTool = 'text' | 'words' | 'file' | 'picture' | 'link' | 'group' | Shape

const PUT: ReadonlySet<Tool> = new Set<Tool>([
  'text',
  'words',
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
])

export function puts(tool: Tool): tool is PutTool {
  return PUT.has(tool)
}

const JOINS: ReadonlySet<Tool> = new Set<Tool>(['line', 'arrow', 'elbow'])

export type PointerKind = 'mouse' | 'pen' | 'touch'

type EdgeEnd = 'from' | 'to'

export interface Hit {
  handle: HandleId | null
  port: { id: string; side: Side } | null
  endpoint: { id: string; end: EdgeEnd } | null
  node: string | null
  edge: string | null
  stroke: string | null
  ink: HandleId | 'turn' | 'inside' | null
}

export const NOTHING: Hit = {
  handle: null,
  port: null,
  endpoint: null,
  node: null,
  edge: null,
  stroke: null,
  ink: null,
}

export interface Down {
  kind: 'down'
  id: number
  pointer: PointerKind
  at: Point
  screen: Point
  time: number
  button: number
  shift: boolean
  adds: boolean
  alt: boolean
  eraser: boolean
  sample: InkPoint
  hit: Hit
}

interface Move {
  kind: 'move'
  id: number
  at: Point
  screen: Point
  samples: InkPoint[]
  hit: Hit
}

interface Penned {
  kind: 'penned'
  id: number
  at: Point
  sample: InkPoint
  eraser: boolean
  hit: Hit
}

export type Input =
  | Down
  | Move
  | Penned
  | { kind: 'up'; id: number; at: Point; screen: Point; hit: Hit }
  | { kind: 'cancel'; id: number }
  | { kind: 'space'; down: boolean }
  | { kind: 'held'; at: Point }

export type Effect =
  | { do: 'pick'; ids: string[]; adding: boolean }
  | { do: 'band'; from: Point; to: Point; was: string[]; adding: boolean }
  | { do: 'clear' }
  | { do: 'edit'; id: string }
  | { do: 'leave' }
  | { do: 'move'; ids: string[]; dx: number; dy: number }
  | {
      do: 'resize'
      ids: string[]
      handle: HandleId
      dx: number
      dy: number
      aspect: boolean
    }
  | { do: 'clone' }
  | {
      do: 'connect'
      from: string
      fromSide: Side
      to: string
      toSide: Side | 'auto'
      head?: boolean
    }
  | { do: 'reconnect'; edge: string; end: EdgeEnd; to: string }
  | { do: 'pull'; tool: PutTool; from: Point; to: Point }
  | { do: 'place'; tool: PutTool; at: Point }
  | { do: 'stroke'; stroke: PendingStroke }
  | { do: 'rub'; at: Point; reach: number }
  | { do: 'cut'; at: Point; reach: number }
  | { do: 'catch'; lasso: Point[]; cards?: boolean }
  | { do: 'unmenu' }
  | { do: 'ink'; dx: number; dy: number; scale: number; turn: number; about: Point }
  | { do: 'pan'; dx: number; dy: number }
  | { do: 'zoom'; at: Point; by: number }
  | { do: 'turn'; at: Point; by: number }
  | { do: 'menu'; at: Point }
  | { do: 'assist' }

export interface PendingStroke {
  tool: InkTool
  size: number
  color: string
  opacity: number
  points: InkPoint[]
}

type Gesture =
  | { kind: 'pan'; id: number; screen: Point; moved: boolean; bare?: boolean }
  | { kind: 'armed'; id: number; at: Point; screen: Point }
  | {
      kind: 'pinch'
      ids: [number, number]
      screens: [Point, Point]
      apart: number
      began: number
      angle: number
      turning: boolean
    }
  | { kind: 'drag'; ids: string[]; screen: Point; dx: number; dy: number }
  | {
      kind: 'resize'
      ids: string[]
      handle: HandleId
      screen: Point
      dx: number
      dy: number
      aspect: boolean
    }
  | { kind: 'band'; from: Point; to: Point; was: string[]; adding: boolean }
  | { kind: 'connect'; id: string; side: Side; to: Point }
  | { kind: 'reconnect'; edge: string; end: EdgeEnd; to: Point }
  | { kind: 'pull'; tool: PutTool; from: Point; to: Point; fromNode: string | null }
  | { kind: 'draw'; stroke: PendingStroke; id: number }
  | { kind: 'erase'; whole: boolean; id: number; last: Point; lastScreen: Point }
  | { kind: 'lasso'; from: Point; points: Point[]; box: boolean; cards?: boolean }
  | { kind: 'ink'; how: 'move' | HandleId | 'turn'; box: Box; from: Point }

interface Driver {
  id: number
  kind: PointerKind
  screen: Point
  since: number
}

export interface Machine {
  gesture: Gesture | null
  driver: Driver | null
  spacing: boolean
  penDown: boolean
  spare: { id: number; screen: Point }[]
  hovered: string | null
}

export function start(): Machine {
  return { gesture: null, driver: null, spacing: false, penDown: false, spare: [], hovered: null }
}

const SLOP = 3

export const FORGIVING = 8

const TWO_FINGERS = 250

export interface Step {
  machine: Machine
  effects: Effect[]
}

export interface Context {
  tool: Tool
  picked: string[]
  editing: string | null
  scale: number
  turn?: number
  turns?: boolean
  inkBox: Box | null
  pen: { tool: InkTool; size: number; color: string; opacity: number }
  eraser: { whole: boolean; size: number; stroke: number }
  lassoBox: boolean
  aspect: boolean
  straighten: boolean
  penSeen: boolean
  fingerDraws: boolean
}

function rubbing(context: Context, shift: boolean, touch: boolean) {
  const whole = context.eraser.whole || shift
  const stroke = context.eraser.stroke + (touch ? FORGIVING : 0)
  return { whole, reach: (whole ? stroke : context.eraser.size) / context.scale }
}

function rubbed(rub: { whole: boolean; reach: number }, at: Point): Effect {
  return { do: rub.whole ? 'rub' : 'cut', at, reach: rub.reach }
}

function rubbingOut(held: Machine, input: Down, context: Context): Step {
  const rub = rubbing(context, input.shift, input.pointer === 'touch')

  return {
    machine: {
      ...held,
      gesture: {
        kind: 'erase',
        whole: rub.whole,
        id: input.id,
        last: input.at,
        lastScreen: input.screen,
      },
    },
    effects: [rubbed(rub, input.at)],
  }
}

function facing(from: Point, to: Point): Side {
  const across = to.x - from.x
  const down = to.y - from.y

  if (Math.abs(across) >= Math.abs(down)) return across >= 0 ? 'right' : 'left'
  return down >= 0 ? 'bottom' : 'top'
}

function ring(from: Point, to: Point): Point[] {
  return [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }]
}

function takesOver(gesture: Gesture, first: Driver, now: number): boolean {
  if (first.kind !== 'touch' || gesture.kind === 'pinch') return false
  if (gesture.kind !== 'draw' && gesture.kind !== 'erase') return true

  return now - first.since <= TWO_FINGERS
}

function begun(gesture: Gesture): boolean {
  switch (gesture.kind) {
    case 'pan':
      return gesture.moved
    case 'armed':
      return false
    case 'drag':
    case 'resize':
      return gesture.dx !== 0 || gesture.dy !== 0
    case 'band':
    case 'pull':
      return gesture.from.x !== gesture.to.x || gesture.from.y !== gesture.to.y
    case 'draw':
      return gesture.stroke.points.length > 1
    case 'lasso':
      return gesture.points.length > 1
    case 'connect':
    case 'reconnect':
      return true
    case 'erase':
    case 'pinch':
    case 'ink':
      return true
  }
}

function onPenned(machine: Machine, input: Penned, context: Context): Step {
  const driver = machine.driver
  if (driver?.id !== input.id) return { machine, effects: [] }

  const pen: Driver = { ...driver, kind: 'pen' }
  const now: Machine = { ...machine, penDown: true, driver: pen }

  const drawing = machine.gesture?.kind === 'draw'

  if (!(input.eraser && drawing) && machine.gesture && begun(machine.gesture)) {
    return { machine: now, effects: [] }
  }

  const tool = input.eraser ? 'erase' : context.tool
  const down: Down = {
    kind: 'down',
    id: input.id,
    pointer: 'pen',
    at: input.at,
    screen: pen.screen,
    time: pen.since,
    button: 0,
    shift: false,
    adds: false,
    alt: false,
    eraser: input.eraser,
    sample: input.sample,
    hit: input.hit,
  }

  if (tool === 'erase') return rubbingOut({ ...now, gesture: null }, down, context)

  if (tool === 'draw') {
    return {
      machine: {
        ...now,
        gesture: { kind: 'draw', id: input.id, stroke: { ...context.pen, points: [input.sample] } },
      },
      effects: [{ do: 'leave' }],
    }
  }

  return { machine: now, effects: [] }
}

const INK: ReadonlySet<Tool> = new Set<Tool>(['draw', 'erase', 'lasso'])

function toolFor(input: Down, context: Context): Tool {
  if (inks(input.pointer, context)) return context.tool
  return INK.has(context.tool) ? 'select' : context.tool
}

export function inks(
  pointer: PointerKind,
  glass: { penSeen: boolean; fingerDraws: boolean },
): boolean {
  return pointer !== 'touch' || !glass.penSeen || glass.fingerDraws
}

export function step(machine: Machine, input: Input, context: Context): Step {
  switch (input.kind) {
    case 'space':
      return { machine: { ...machine, spacing: input.down }, effects: [] }
    case 'down':
      return onDown(machine, input, context)
    case 'move': {
      const next = onMove(machine, input, context)
      const driver = next.machine.driver
      if (driver?.id !== input.id) return next

      return {
        machine: { ...next.machine, driver: { ...driver, screen: input.screen } },
        effects: next.effects,
      }
    }
    case 'penned':
      return onPenned(machine, input, context)
    case 'up':
      return onUp(machine, input, context)
    case 'cancel':
      return onCancel(machine, input.id)
    case 'held':
      return onHeld(machine, input.at, context)
  }
}

export function drives(machine: Machine, id: number): boolean {
  const one = machine.gesture
  return (
    machine.driver === null ||
    machine.driver.id === id ||
    (one?.kind === 'pinch' && one.ids.includes(id))
  )
}

function onCancel(machine: Machine, id: number): Step {
  if (!drives(machine, id)) {
    return {
      machine: { ...machine, spare: machine.spare.filter((held) => held.id !== id) },
      effects: [],
    }
  }

  return {
    machine: { ...machine, gesture: null, spare: [], penDown: false, driver: null },
    effects: [],
  }
}

function onDown(machine: Machine, input: Down, context: Context): Step {
  if (input.pointer === 'touch' && machine.penDown) return { machine, effects: [] }

  const now: Machine =
    input.pointer === 'pen' ? { ...machine, gesture: null, spare: [], driver: null } : machine

  const penDown = now.penDown || input.pointer === 'pen'
  const tool = toolFor(input, context)

  if (input.pointer === 'touch' && now.gesture && now.driver) {
    const first = now.driver

    if (takesOver(now.gesture, first, input.time)) {
      return {
        machine: {
          ...now,
          penDown,
          driver: { id: input.id, kind: 'touch', screen: input.screen, since: input.time },
          gesture: {
            kind: 'pinch',
            ids: [first.id, input.id],
            screens: [first.screen, input.screen],
            apart: Math.hypot(input.screen.x - first.screen.x, input.screen.y - first.screen.y),
            began: angleOf(first.screen, input.screen),
            angle: angleOf(first.screen, input.screen),
            turning: false,
          },
        },
        effects: [],
      }
    }

    return {
      machine: {
        ...now,
        penDown,
        spare: [...now.spare, { id: input.id, screen: input.screen }],
      },
      effects: [],
    }
  }

  if (now.gesture) return { machine: { ...now, penDown }, effects: [] }

  const held: Machine = {
    ...now,
    penDown,
    driver: { id: input.id, kind: input.pointer, screen: input.screen, since: input.time },
  }

  if (input.eraser) return rubbingOut(held, input, context)

  if (input.button === 2 && input.pointer !== 'pen') {
    return {
      machine: { ...held, driver: now.driver },
      effects: [{ do: 'menu', at: input.at }],
    }
  }

  if (now.spacing || input.button === 1 || tool === 'hand') {
    return {
      machine: {
        ...held,
        gesture: { kind: 'pan', id: input.id, screen: input.screen, moved: false },
      },
      effects: [],
    }
  }

  if (puts(tool)) {
    return {
      machine: {
        ...held,
        gesture: { kind: 'pull', tool, from: input.at, to: input.at, fromNode: input.hit.node },
      },
      effects: [{ do: 'leave' }],
    }
  }

  switch (tool) {
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
    case 'erase':
      return rubbingOut(held, input, context)
    case 'lasso':
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

      return {
        machine: {
          ...held,
          gesture: {
            kind: 'lasso',
            from: input.at,
            points: context.lassoBox ? ring(input.at, input.at) : [input.at],
            box: context.lassoBox,
          },
        },
        effects: [],
      }
    case 'select':
      break
  }

  return select(held, input, context)
}

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
          aspect: input.shift || context.aspect,
        },
      },
      effects: [],
    }
  }

  if (hit.endpoint) {
    return {
      machine: {
        ...machine,
        gesture: {
          kind: 'reconnect',
          edge: hit.endpoint.id,
          end: hit.endpoint.end,
          to: input.at,
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

  if (context.editing !== null && hit.node === context.editing) {
    return { machine: { ...machine, driver: null }, effects: [] }
  }

  if (!hit.node) {
    if (input.pointer === 'touch') {
      return {
        machine: {
          ...machine,
          gesture: { kind: 'pan', id: input.id, screen: input.screen, moved: false, bare: true },
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
  if (adding || !context.picked.includes(hit.node)) {
    effects.push({ do: 'pick', ids: [hit.node], adding })
  }

  const ids = adding
    ? context.picked.includes(hit.node)
      ? context.picked.filter((one) => one !== hit.node)
      : [...context.picked, hit.node]
    : context.picked.includes(hit.node)
      ? [...context.picked]
      : [hit.node]

  if (!ids.length) return { machine: { ...machine, driver: null }, effects }

  if (input.alt) effects.push({ do: 'clone' })

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

  if (machine.driver && input.id !== machine.driver.id && one.kind !== 'pinch') {
    return { machine, effects: [] }
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
      if (one.apart > 0 && Math.abs(apart - one.apart) > 0.5) {
        effects.push({ do: 'zoom', at: middle, by: apart / one.apart })
      }

      const angle = angleOf(screens[0], screens[1])
      const turning =
        one.turning ||
        (!!context.turns && Math.abs(settledTurn(angle - one.began)) >= TURN_DEADBAND)
      if (turning && context.turns) {
        const by = settledTurn(angle - (one.turning ? one.angle : one.began))
        if (by) effects.push({ do: 'turn', at: middle, by })
      }

      return {
        machine: { ...machine, gesture: { ...one, screens, apart, angle, turning } },
        effects,
      }
    }

    case 'drag':
    case 'resize':
      return {
        machine: {
          ...machine,
          gesture: {
            ...one,
            ...planeDelta(input.screen.x - one.screen.x, input.screen.y - one.screen.y, context),
          },
        },
        effects: [],
      }

    case 'band': {
      const band = { ...one, to: input.at }
      return {
        machine: { ...machine, gesture: band },
        effects: [{ do: 'band', from: band.from, to: band.to, was: band.was, adding: band.adding }],
      }
    }

    case 'connect':
    case 'reconnect':
    case 'pull':
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

      const touch = machine.driver?.kind === 'touch'
      const rub = rubbing(context, one.whole, touch)
      return {
        machine: {
          ...machine,
          gesture: { ...one, last: input.at, lastScreen: input.screen },
        },
        effects: rubbedBetween(
          { at: one.last, screen: one.lastScreen },
          input,
          context.scale,
          rub.reach,
        ).map((at) => rubbed(rub, at)),
      }
    }

    case 'lasso':
      return {
        machine: {
          ...machine,
          gesture: {
            ...one,
            points: one.box ? ring(one.from, input.at) : [...one.points, input.at],
          },
        },
        effects: [],
      }

    case 'armed': {
      if (input.id !== one.id) return { machine, effects: [] }
      if (Math.hypot(input.screen.x - one.screen.x, input.screen.y - one.screen.y) <= SLOP) {
        return { machine, effects: [] }
      }
      return {
        machine: {
          ...machine,
          gesture: {
            kind: 'lasso',
            from: one.at,
            points: [one.at, input.at],
            box: false,
            cards: true,
          },
        },
        effects: [{ do: 'unmenu' }],
      }
    }

    case 'ink':
      return { machine, effects: [inkEffect(one, input.at)] }
  }
}

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

  const reach = Math.max(box.width, box.height, 1) / 2
  const was = Math.hypot(one.from.x - middle.x, one.from.y - middle.y)
  const now = Math.hypot(at.x - middle.x, at.y - middle.y)
  const scale = was > reach * 0.1 ? Math.max(0.05, now / was) : 1

  return { do: 'ink', dx: 0, dy: 0, scale, turn: 0, about: middle }
}

function onUp(machine: Machine, input: Extract<Input, { kind: 'up' }>, context: Context): Step {
  const one = machine.gesture
  const spare = machine.spare.filter((held) => held.id !== input.id)

  if (!one) return { machine: { ...machine, spare, penDown: false, driver: null }, effects: [] }

  if (one.kind === 'pinch' && one.ids.includes(input.id)) {
    const left = one.ids[0] === input.id ? 1 : 0
    return {
      machine: {
        ...machine,
        spare,
        driver: {
          id: one.ids[left],
          kind: 'touch',
          screen: one.screens[left],
          since: machine.driver?.since ?? 0,
        },
        gesture: { kind: 'pan', id: one.ids[left], screen: one.screens[left], moved: true },
      },
      effects: [],
    }
  }

  if (machine.driver !== null && machine.driver.id !== input.id) {
    return { machine: { ...machine, spare }, effects: [] }
  }

  const rest: Machine = { ...machine, gesture: null, spare, penDown: false, driver: null }

  switch (one.kind) {
    case 'pan':
      return { machine: rest, effects: one.moved ? [] : [{ do: 'clear' }] }
    case 'pinch':
      return { machine: rest, effects: [] }

    case 'drag': {
      if (Math.hypot(one.dx, one.dy) * context.scale <= SLOP) return { machine: rest, effects: [] }
      return { machine: rest, effects: [{ do: 'move', ids: one.ids, dx: one.dx, dy: one.dy }] }
    }

    case 'resize': {
      if (Math.hypot(one.dx, one.dy) * context.scale <= SLOP) return { machine: rest, effects: [] }
      return {
        machine: rest,
        effects: [
          {
            do: 'resize',
            ids: one.ids,
            handle: one.handle,
            dx: one.dx,
            dy: one.dy,
            aspect: one.aspect,
          },
        ],
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

    case 'reconnect': {
      const target = input.hit.node
      if (!target) return { machine: rest, effects: [] }

      return {
        machine: rest,
        effects: [{ do: 'reconnect', edge: one.edge, end: one.end, to: target }],
      }
    }

    case 'pull': {
      const span = Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y)
      if (span * context.scale <= SLOP) {
        return { machine: rest, effects: [{ do: 'place', tool: one.tool, at: one.from }] }
      }

      const target = input.hit.node
      if (JOINS.has(one.tool) && one.fromNode && target && target !== one.fromNode) {
        return {
          machine: rest,
          effects: [
            {
              do: 'connect',
              from: one.fromNode,
              fromSide: facing(one.from, one.to),
              to: target,
              toSide: 'auto',
              head: one.tool === 'arrow',
            },
          ],
        }
      }

      return {
        machine: rest,
        effects: [{ do: 'pull', tool: one.tool, from: one.from, to: one.to }],
      }
    }

    case 'draw':
      return { machine: rest, effects: [{ do: 'stroke', stroke: one.stroke }] }

    case 'erase':
      return { machine: rest, effects: [] }

    case 'lasso':
      return {
        machine: rest,
        effects: [{ do: 'catch', lasso: one.points, ...(one.cards ? { cards: true } : {}) }],
      }

    case 'armed':
      return { machine: rest, effects: [] }

    case 'ink':
      return { machine: rest, effects: [] }
  }
}

function onHeld(machine: Machine, at: Point, context: Context): Step {
  const one = machine.gesture
  if (!one) return { machine, effects: [] }

  if (one.kind === 'draw') {
    return { machine, effects: context.straighten ? [{ do: 'assist' }] : [] }
  }

  if (one.kind === 'pan' && one.bare && !one.moved && machine.driver?.kind === 'touch') {
    return {
      machine: { ...machine, gesture: { kind: 'armed', id: one.id, at, screen: one.screen } },
      effects: [{ do: 'menu', at }],
    }
  }
  if ((one.kind === 'pan' || one.kind === 'drag') && machine.driver?.kind !== 'pen') {
    return { machine: { ...machine, gesture: null }, effects: [{ do: 'menu', at }] }
  }

  return { machine, effects: [] }
}

function angleOf(one: Point, other: Point): number {
  return Math.atan2(other.y - one.y, other.x - one.x)
}

function planeDelta(dx: number, dy: number, context: Context): { dx: number; dy: number } {
  const by = turnedBy(dx, dy, -(context.turn ?? 0))
  return { dx: by.x / context.scale, dy: by.y / context.scale }
}
