import type { CanvasEdge, CanvasNode, InkPoint, InkStroke } from '@orden/markdown/canvas'
import type { Hand } from '@orden/markdown/plane'
import { CanvasStore } from '../../canvas/src/api'
import { workspace } from '../../workspace/src/api'
import { clamp, phone, scheme, smooth, type LoopScene } from './kit'
import { keysOf, moveAt, type Move, PAUSE, typedAt } from './motion'
import { onPlane, type Point, type Pointer } from './pointer'
import type { Stage } from './run'
import { drifted, frameAt, TEAM } from './scenes'
import { BASE } from './space'

interface View {
  x: number
  y: number
  scale: number
}
const SHOP = '## Shop window\nThree bikes, one per colour'
const OPENING = '## Opening\nFriday 18:00, music at 19:00'
const at = {
  out: 1400,
  there: 3300,
  click: 4200,
  typing: 4700,
  fetch: 5200,
  grab: 6300,
  placed: 8300,
  card: 9000,
  opening: 9300,
  linkFrom: 16200,
  linked: 17600,
  lift: 18600,
  moved: 20300,
  groupFrom: 21800,
  grouped: 23800,
  ring: 24900,
  ringed: 26300,
  tick: 26700,
  ticked: 27200,
  back: 29000,
  home: 30900,
  end: 33600,
}
const point = (x: number, y: number) => () => ({ x, y })
const mix = (from: number, to: number, by: number) => from + (to - from) * by
const span = (ms: number, from: number, to: number) => smooth(clamp((ms - from) / (to - from)))
const HOME: readonly Point[] = [
  { x: -250, y: 230 },
  { x: -150, y: 150 },
  { x: 60, y: 135 },
]
const AWAY: readonly Point[] = [
  { x: 1400, y: 170 },
  { x: 700, y: 210 },
  { x: 1300, y: -320 },
]
const handMoves = (who: number, during: Move[]): Move[] => [
  { at: 0, to: point(HOME[who]?.x ?? 0, HOME[who]?.y ?? 0) },
  { at: at.out + who * 200, to: point(HOME[who]?.x ?? 0, HOME[who]?.y ?? 0) },
  { at: at.there + who * 250, to: point(AWAY[who]?.x ?? 0, AWAY[who]?.y ?? 0) },
  ...during,
  { at: at.back + who * 150, to: point(AWAY[who]?.x ?? 0, AWAY[who]?.y ?? 0) },
  { at: at.home + who * 200, to: point(HOME[who]?.x ?? 0, HOME[who]?.y ?? 0) },
]
const MARA = handMoves(0, [
  { at: at.fetch, to: point(1400, 170) },
  { at: at.grab, to: point(1720, -170) },
  { at: at.placed, to: point(1230, -150), drag: true },
  { at: at.placed + 1500, to: point(1400, 170) },
])
const JONAS = handMoves(1, [
  { at: at.card - 900, to: point(700, 210) },
  { at: at.card, to: point(760, 60) },
  { at: at.opening + 400, to: point(930, 95) },
  { at: at.linkFrom - 600, to: point(940, 120) },
  { at: at.linkFrom, to: point(870, -125) },
  { at: at.linked, to: point(890, 30), drag: true },
  { at: at.linked + 1400, to: point(700, 210) },
])
const AIKO = handMoves(2, [
  { at: at.groupFrom - 900, to: point(1300, -320) },
  { at: at.groupFrom, to: point(680, -320) },
  { at: at.grouped, to: point(1420, 240), drag: true },
  { at: at.ring - 300, to: point(1150, 95) },
  { at: at.ticked + 300, to: point(1030, -200) },
  { at: at.ticked + 1500, to: point(1300, -320) },
])
const YOU: Move[] = [
  { at: 0, to: point(330, 300) },
  { at: at.there + 300, to: point(1180, 250) },
  { at: at.click, to: point(870, -190), press: true },
  { at: at.click + 260, to: point(870, -190), press: true },
  { at: at.typing + 2400, to: point(1010, -80) },
  { at: at.lift - 500, to: point(1010, 300) },
  { at: at.lift, to: point(900, 110), press: true },
  { at: at.moved, to: point(1230, 130), drag: true },
  { at: at.moved + 1500, to: point(1180, 330) },
  { at: at.home, to: point(330, 300) },
]
const ring = (k: number): Point => {
  const turn = Math.PI * 2 * k * 1.08 - 2.7
  const wobble = 1 + 0.05 * Math.sin(k * 7)
  return { x: 1152 + 74 * wobble * Math.cos(turn), y: 103 + 15 * wobble * Math.sin(turn) }
}
const tick = (k: number): Point =>
  k < 0.3
    ? { x: 990 + 12 * (k / 0.3), y: -232 + 12 * (k / 0.3) }
    : { x: 1002 + 30 * ((k - 0.3) / 0.7), y: -220 - 28 * ((k - 0.3) / 0.7) }
function strokeOf(id: string, path: (k: number) => Point, until: number, colour: string): InkStroke {
  const count = Math.max(2, Math.round(90 * until))
  const points: InkPoint[] = Array.from({ length: count }, (_, step) => {
    const spot = path((step / 89) * 1)
    return { ...spot, pressure: 0.55 + 0.15 * Math.sin((step / 90) * Math.PI), tiltX: 0, tiltY: 0, t: step * 8 }
  })
  return { id: `demo-${id}`, tool: 'pen', color: colour, size: 3, points }
}
export function boardScene(stage: Stage, you: () => Pointer): LoopScene {
  const origin = location.origin
  const shop = keysOf(SHOP.slice(15), 91, 0.95)
  const opening = keysOf(OPENING.slice(11), 92, 0.95)
  const home = (): View => (phone() ? { x: 40, y: -110, scale: 0.62 } : { x: 10, y: -10, scale: 1 })
  const away = (): View => (phone() ? { x: 1050, y: -40, scale: 0.46 } : { x: 1050, y: -40, scale: 1 })
  let shownKey = ''
  let handsAt = -Infinity
  const viewAt = (ms: number): View => {
    const from = home()
    const to = away()
    const by = ms < at.back ? span(ms, at.out, at.there) : 1 - span(ms, at.back, at.home)
    return {
      x: mix(from.x, to.x, by),
      y: mix(from.y, to.y, by),
      scale: from.scale * Math.pow(to.scale / from.scale, by),
    }
  }
  const sceneAt = (ms: number) => {
    const base = frameAt('canvas', 1, origin, phone())
    const nodes: CanvasNode[] = []
    const edges: CanvasEdge[] = [...base.edges]
    const ink: InkStroke[] = []
    const colour = TEAM[2][scheme()]
    if (ms >= at.groupFrom + PAUSE) {
      const hand = moveAt(ms, AIKO).at ?? { x: 1420, y: 240 }
      const end = ms >= at.grouped ? { x: 1420, y: 240 } : hand
      nodes.push({
        id: 'shop-launch',
        type: 'group',
        label: 'Shop launch',
        x: 680,
        y: -320,
        width: Math.max(40, Math.round(end.x - 680)),
        height: Math.max(40, Math.round(end.y + 320)),
        color: '6',
      })
    }
    nodes.push(...base.nodes)
    if (ms >= at.click + 300) {
      const grow = span(ms, at.click + 300, at.click + 600)
      nodes.push({
        id: 'shop',
        type: 'text',
        text: `## Shop window\n${typedAt(shop, ms - at.typing)}`,
        x: Math.round(870 - 150 * grow),
        y: Math.round(-190 - 60 * grow),
        width: Math.max(20, Math.round(300 * grow)),
        height: Math.max(20, Math.round(120 * grow)),
        color: '4',
      })
    }
    if (ms >= at.grab) {
      const hand = ms < at.placed ? (moveAt(ms, MARA).at ?? { x: 1230, y: -150 }) : { x: 1230, y: -150 }
      nodes.push({
        id: 'route',
        type: 'file',
        file: `${origin}${BASE}demo/route.svg`,
        x: Math.round(hand.x - 140),
        y: Math.round(hand.y - 95),
        width: 280,
        height: 190,
      })
    }
    if (ms >= at.card) {
      const grow = span(ms, at.card, at.card + 300)
      const held = ms >= at.lift + PAUSE ? (moveAt(ms, YOU).at ?? { x: 1230, y: 130 }) : { x: 900, y: 110 }
      const place = ms >= at.moved ? { x: 1230, y: 130 } : held
      nodes.push({
        id: 'opening',
        type: 'text',
        text: `## Opening\n${typedAt(opening, ms - at.opening)}`,
        x: Math.round(place.x - 140 - 10 * (1 - grow)),
        y: Math.round(place.y - 70),
        width: Math.max(20, Math.round(300 * grow)),
        height: Math.max(20, Math.round(120 * grow)),
        color: '2',
      })
    }
    if (ms >= at.linkFrom + PAUSE && ms < at.linked) {
      const hand = moveAt(ms, JONAS).at ?? { x: 890, y: 30 }
      nodes.push({
        id: 'tip',
        type: 'text',
        text: '',
        x: Math.round(hand.x),
        y: Math.round(hand.y),
        width: 2,
        height: 2,
      })
      edges.push({ id: 'shop-tip', fromNode: 'shop', fromSide: 'bottom', toNode: 'tip', toSide: 'top', toEnd: 'arrow' })
    }
    if (ms >= at.linked)
      edges.push({
        id: 'shop-opening',
        fromNode: 'shop',
        fromSide: 'bottom',
        toNode: 'opening',
        toSide: 'top',
        toEnd: 'arrow',
      })
    if (ms >= at.ring) ink.push(strokeOf('ring', ring, span(ms, at.ring, at.ringed), colour))
    if (ms >= at.tick) ink.push(strokeOf('tick', tick, span(ms, at.tick, at.ticked), colour))
    return { nodes, edges, ink }
  }
  const placed = (ms: number): Point[] => {
    const points = [MARA, JONAS, AIKO].map((moves, who) => moveAt(ms, moves).at ?? HOME[who] ?? { x: 0, y: 0 })
    const inked = ms >= at.ring && ms < at.ringed ? ring(clamp((ms - at.ring) / (at.ringed - at.ring))) : null
    const ticking = ms >= at.tick && ms < at.ticked ? tick(clamp((ms - at.tick) / (at.ticked - at.tick))) : null
    const drift = drifted(points, ms / 1000)
    return points.map((one, who) => (who === 2 && (inked ?? ticking) ? (inked ?? ticking ?? one) : (drift[who] ?? one)))
  }
  return {
    period: at.end,
    still: 0,
    ready: async () => {
      workspace.activate(stage.canvas.id)
      await Promise.resolve()
    },
    tick: (phase, now) => {
      const ms = phase * at.end
      if (workspace.activeTabId !== stage.canvas.id) workspace.activate(stage.canvas.id)
      const store = CanvasStore.drawing(stage.canvas.note, workspace.tabs)
      if (!store) return
      const view = viewAt(ms)
      const camera = store.camera
      if (camera.x !== view.x || camera.y !== view.y || camera.scale !== view.scale) store.camera = view
      const drawn = sceneAt(ms)
      const key = JSON.stringify([
        drawn.nodes.map((one) => [one.x, one.y, one.width, one.height, 'text' in one ? one.text.length : 0]),
        drawn.edges.length,
        drawn.ink.map((one) => one.points.length),
      ])
      if (key !== shownKey) {
        shownKey = key
        store.arrived({
          ...store.canvas,
          nodes: drawn.nodes,
          edges: drawn.edges,
          ink: [...store.canvas.ink.filter((one) => !one.id.startsWith('demo-')), ...drawn.ink],
        })
      }
      if (now - handsAt >= 90 || now < handsAt) {
        handsAt = now
        const hands: Hand[] = placed(ms).map((spot, index) => ({
          id: index + 1,
          name: TEAM[index]?.name ?? '',
          colour: TEAM[index]?.[scheme()] ?? '',
          at: spot,
          stroke: null,
        }))
        store.handsAre(hands)
      }
      const mine = moveAt(ms, YOU)
      you().show(mine.at ? onPlane('.canvas.orden-host', view, mine.at) : null, mine.press)
    },
  }
}
