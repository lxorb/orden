import type { CanvasEdge, CanvasNode } from '@orden/markdown/canvas'
import { LAUNCH, PAGE, PLAN, PRESS, ROUTES, WRITTEN } from './space'

export const SCENES = ['canvas', 'write', 'browse', 'organize', 'overview'] as const
export type Scene = (typeof SCENES)[number]
interface View {
  x: number
  y: number
  scale: number
}
type Shown = 'canvas' | 'note' | 'page'
export interface Point {
  x: number
  y: number
}
export interface Frame {
  shown: Shown
  tree: boolean
  moved: boolean
  overview: boolean
  view: View
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  cards: string
  hands: readonly [Point, Point, Point]
  typed: readonly [number, number]
}
export const TEAM = [
  { name: 'Mara Lind', dark: '#e9973f', light: '#ec7500' },
  { name: 'Jonas Weber', dark: '#53dfdd', light: '#00b3b0' },
  { name: 'Aiko Tan', dark: '#a882ff', light: '#7852ee' },
] as const
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const smooth = (value: number) => value * value * (3 - 2 * value)
const span = (at: number, from: number, to: number) => smooth(clamp((at - from) / (to - from)))
const mix = (from: number, to: number, by: number) => from + (to - from) * by
const toward = (from: Point, to: Point, by: number): Point => ({ x: mix(from.x, to.x, by), y: mix(from.y, to.y, by) })
const glide = (from: View, to: View, by: number): View => ({
  x: mix(from.x, to.x, by),
  y: mix(from.y, to.y, by),
  scale: from.scale * Math.pow(to.scale / from.scale, by),
})
const RIDE_FROM = { x: -60, y: 150 }
const RIDE_TO = { x: -100, y: -260 }
const GRIP = { x: 230, y: 105 }
const ROUTES_FROM = { x: 280, y: -260 }
const ROUTES_TO = { x: 280, y: -130 }
const WIDE: View = { x: 10, y: -10, scale: 1 }
const START: View = { x: 30, y: 10, scale: 0.9 }
const INTO_PLAN: View = { x: -360, y: -135, scale: 2.4 }
const INTO_PAGE: View = { x: 430, y: -215, scale: 2.2 }
const BY_ROUTES: View = { x: 380, y: -150, scale: 1.5 }
const ASIDE: View = { x: 60, y: -10, scale: 0.95 }
const NARROW: View = { x: 40, y: -110, scale: 0.62 }
const NARROW_PLAN: View = { x: -360, y: -135, scale: 1.15 }
const NARROW_PAGE: View = { x: 430, y: -215, scale: 1 }
const NARROW_ROUTES: View = { x: 430, y: -150, scale: 0.8 }
const NARROW_PRESS: View = { x: 430, y: 95, scale: 0.7 }
const REST: readonly [Point, Point, Point] = [
  { x: -250, y: 230 },
  { x: -150, y: 150 },
  { x: 60, y: 135 },
]
const ARROW_FROM = { x: -190, y: -135 }
const ARROW_TO = { x: -100, y: -195 }
const DROP = { x: 50, y: 10 }
const AIKO_FROM = { x: 470, y: 250 }
function cardsAt(origin: string, ride: Point, picture: number, routes: Point | null, moved: boolean) {
  const nodes: CanvasNode[] = [
    { id: 'week', type: 'group', label: 'Launch week', x: -560, y: -300, width: 400, height: 470 },
    { id: 'plan', type: 'file', file: PLAN, x: -530, y: -260, width: 340, height: 250, color: '5' },
    {
      id: 'voice',
      type: 'text',
      text: '## Brand voice\nCalm, quick, a little dry.',
      x: -530,
      y: 30,
      width: 340,
      height: 110,
      color: '2',
    },
    {
      id: 'ride',
      type: 'text',
      text: '## Ride test\n- Saturday 09:00\n- River loop, 14 km',
      x: Math.round(ride.x),
      y: Math.round(ride.y),
      width: 280,
      height: 130,
      color: '4',
    },
    {
      id: 'page',
      type: 'text',
      text: `### [Kestrel One](${origin}${PAGE})\nThe launch page, live`,
      x: 280,
      y: -260,
      width: 300,
      height: 100,
    },
    {
      id: 'press',
      type: 'file',
      file: moved ? `${LAUNCH}/${PRESS}` : PRESS,
      x: 280,
      y: 10,
      width: 300,
      height: 170,
      color: '3',
    },
  ]
  if (picture > 0) {
    const width = Math.round(300 * mix(0.6, 1, picture))
    const height = Math.round(200 * mix(0.6, 1, picture))
    nodes.push({
      id: 'bike',
      type: 'file',
      file: `${origin}/demo/bike.svg`,
      x: 50 - width / 2,
      y: 10 - height / 2,
      width,
      height,
    })
  }
  if (routes)
    nodes.push({
      id: 'routes',
      type: 'text',
      text: `### [Weekend routes](${origin}${ROUTES})\nThree flat rides, done by lunch`,
      x: Math.round(routes.x),
      y: Math.round(routes.y),
      width: 300,
      height: 100,
    })
  return nodes
}
function linesAt(arrow: boolean, routes: boolean): CanvasEdge[] {
  const edges: CanvasEdge[] = [
    { id: 'plan-voice', fromNode: 'plan', fromSide: 'bottom', toNode: 'voice', toSide: 'top', toEnd: 'arrow' },
  ]
  if (arrow)
    edges.push({ id: 'plan-ride', fromNode: 'plan', fromSide: 'right', toNode: 'ride', toSide: 'left', toEnd: 'arrow' })
  if (routes)
    edges.push({
      id: 'page-routes',
      fromNode: 'page',
      fromSide: 'bottom',
      toNode: 'routes',
      toSide: 'top',
      toEnd: 'arrow',
    })
  return edges
}
export const drifted = (hands: readonly Point[], time: number): Point[] =>
  hands.map((one, at) => ({
    x: one.x + 7 * Math.sin(time * 0.8 + at * 2.1),
    y: one.y + 5 * Math.sin(time * 1.1 + at * 1.3),
  }))
export function frameAt(scene: Scene, given: number, origin: string, phone = false): Frame {
  const at = clamp(given)
  const order = SCENES.indexOf(scene)
  const past = (one: Scene) => order > SCENES.indexOf(one)
  const carry = scene === 'canvas' ? span(at, 0.12, 0.45) : 1
  const ride = toward(RIDE_FROM, RIDE_TO, carry)
  const arrow = past('canvas') || at >= 0.58
  const picture = past('canvas') ? 1 : at < 0.72 ? 0 : mix(0.05, 1, span(at, 0.72, 0.8))
  const pulled = scene === 'browse' ? (at < 0.6 ? null : span(at, 0.6, 0.85)) : past('browse') ? 1 : null
  const routes = pulled === null ? null : toward(ROUTES_FROM, ROUTES_TO, pulled)
  const moved = scene === 'overview' || (scene === 'organize' && at >= 0.5)
  const nodes = cardsAt(origin, ride, picture, routes, moved)
  const edges = linesAt(arrow, past('browse') || (scene === 'browse' && at >= 0.9))
  let hands: [Point, Point, Point] = [...REST]
  const wide = phone ? NARROW : WIDE
  let view = wide
  let shown: Shown = 'canvas'
  if (scene === 'canvas') {
    const grip = { x: ride.x + GRIP.x, y: ride.y + GRIP.y }
    hands = [
      at < 0.12 ? toward({ x: -300, y: 260 }, grip, span(at, 0, 0.12)) : grip,
      at < 0.45
        ? REST[1]
        : at < 0.6
          ? toward(ARROW_FROM, ARROW_TO, span(at, 0.45, 0.58))
          : toward(ARROW_TO, REST[1], span(at, 0.6, 0.7)),
      at < 0.8 ? toward(AIKO_FROM, DROP, span(at, 0.6, 0.72)) : toward(DROP, REST[2], span(at, 0.8, 0.9)),
    ]
    view = phone ? { x: ride.x + 140, y: ride.y + 145, scale: NARROW.scale } : glide(START, WIDE, span(at, 0, 1))
  } else if (scene === 'write') {
    const close = span(at, 0, 0.3)
    hands = [toward(REST[0], { x: -400, y: -180 }, close), toward(REST[1], { x: -300, y: -60 }, close), REST[2]]
    view = glide(wide, phone ? NARROW_PLAN : INTO_PLAN, close)
    if (at >= 0.3) shown = 'note'
  } else if (scene === 'browse') {
    if (at < 0.6) view = glide(wide, phone ? NARROW_PAGE : INTO_PAGE, span(at, 0, 0.25))
    else view = glide(phone ? NARROW_ROUTES : BY_ROUTES, wide, span(at, 0.85, 1))
    if (at >= 0.25 && at < 0.6) shown = 'page'
    hands = [REST[0], REST[1], routes ? { x: routes.x + 20, y: routes.y + 112 } : { x: 300, y: -148 }]
  } else if (scene === 'organize') {
    view = glide(wide, phone ? NARROW_PRESS : ASIDE, span(at, 0, 0.2))
    hands = [REST[0], toward(REST[1], { x: 430, y: 90 }, span(at, 0.25, 0.5)), REST[2]]
  }
  const typed: [number, number] =
    scene === 'canvas'
      ? [0, 0]
      : scene === 'write'
        ? [
            Math.round(WRITTEN[0].words.length * clamp((at - 0.35) / 0.5)),
            Math.round(WRITTEN[1].words.length * clamp((at - 0.42) / 0.5)),
          ]
        : [WRITTEN[0].words.length, WRITTEN[1].words.length]
  return {
    shown,
    tree: scene === 'organize' && at >= 0.1,
    moved,
    overview: scene === 'overview' && at >= 0.2,
    view,
    nodes,
    edges,
    cards: JSON.stringify([nodes.map((one) => [one.x, one.y, one.width, 'file' in one ? one.file : '']), edges.length]),
    hands,
    typed,
  }
}
export function writtenAt(text: string, typed: readonly [number, number]): { text: string; carets: [number, number] } {
  let out = text
  const carets: [number, number] = [0, 0]
  let shift = 0
  WRITTEN.forEach((one, at) => {
    const place = text.indexOf(one.after) + one.after.length + shift
    const count = typed[at] ?? 0
    const words = count > 0 ? `\n- ${one.words.slice(0, count)}` : ''
    out = out.slice(0, place) + words + out.slice(place)
    shift += words.length
    carets[at] = place + words.length
  })
  return { text: out, carets }
}
export function replacement(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null
  let head = 0
  while (head < from.length && head < to.length && from[head] === to[head]) head++
  let tail = 0
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  )
    tail++
  return { from: head, to: from.length - tail, insert: to.slice(head, to.length - tail) }
}
