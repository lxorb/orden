import { type Feel, resting, SHARE, spring, step } from '../../springs/src/api'
import { between, frameOutline, type Point } from './sun-shape'

export interface Piece {
  outline: readonly Point[]
  each: number
  slot: number
  index: number
  accent: string
  ground: string
}
export interface Growing {
  arrived: Promise<boolean>
  grown: Promise<void>
}
const PATIENCE = 1500
const GROWING: Feel = { response: 0.62, damping: 0.94 }
const SVG = 'http://www.w3.org/2000/svg'
const EDGE_GONE = 0.85
const GHOST_GONE = 0.7

function promised<Value>() {
  let settle: (value: Value) => void = () => undefined
  const promise = new Promise<Value>((done) => {
    settle = done
  })
  return { promise, settle: (value: Value) => settle(value) }
}
function boundsOf(points: readonly Point[]) {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const [x, y] of points) {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}
const pathOf = (points: readonly Point[]): string =>
  `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`

function edgeOver(accent: string) {
  const layer = document.createElementNS(SVG, 'svg')
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '30',
    overflow: 'visible',
  })
  const edge = document.createElementNS(SVG, 'path')
  edge.setAttribute('fill', 'none')
  edge.setAttribute('stroke-width', '1')
  edge.style.stroke = accent
  layer.append(edge)
  document.body.append(layer)
  return { layer, edge }
}

function ghostOf(here: HTMLElement, piece: Piece, pane: HTMLElement): HTMLElement {
  const ghost = here.cloneNode(true) as HTMLElement
  ghost.querySelector(`[data-slot="${piece.slot}"] [data-index="${piece.index}"]`)?.remove()
  ghost.querySelector('.trail')?.remove()
  ghost.removeAttribute('data-new-here')
  ghost.setAttribute('inert', '')
  ghost.setAttribute('aria-hidden', 'true')
  const room = pane.getBoundingClientRect()
  const box = here.getBoundingClientRect()
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${box.left - room.left}px`,
    top: `${box.top - room.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    pointerEvents: 'none',
    margin: '0',
  })
  return ghost
}

export function growInto(card: HTMLElement, here: HTMLElement, piece: Piece): Growing {
  const target = frameOutline(piece.slot, piece.each)
  const pane = card.parentElement ?? card
  const ghost = ghostOf(here, piece, pane)
  const kept = {
    transform: card.style.transform,
    transformOrigin: card.style.transformOrigin,
    clipPath: card.style.clipPath,
    pointerEvents: card.style.pointerEvents,
    willChange: card.style.willChange,
    background: card.style.background,
  }
  const arriving = promised<boolean>()
  const growing = promised<undefined>()
  const arrive = arriving.settle
  const finish = () => growing.settle(undefined)
  const waiting = setTimeout(() => {
    watching.disconnect()
    arrive(false)
    finish()
  }, PATIENCE)
  const watching = new MutationObserver(() => {
    if (here.isConnected) return
    watching.disconnect()
    clearTimeout(waiting)
    start()
  })
  watching.observe(card, { childList: true, subtree: true })

  function start() {
    const box = card.getBoundingClientRect()
    const { layer, edge } = edgeOver(piece.accent)
    const progress = spring(0, SHARE)
    progress.to = 1
    const draw = (grownBy: number) => {
      const points = piece.outline.map((from, index) => {
        const [u, v] = target[index] ?? [0, 0]
        return between(from, [box.left + u * box.width, box.top + v * box.height], grownBy)
      })
      const area = boundsOf(points)
      const scale = Math.max(area.width / box.width, area.height / box.height)
      const left = area.left + area.width / 2 - (box.width * scale) / 2
      const top = area.top + area.height / 2 - (box.height * scale) / 2
      const inside = points.map(([x, y]): Point => [(x - left) / scale, (y - top) / scale])
      card.style.transformOrigin = '0 0'
      card.style.transform = `translate(${(left - box.left).toFixed(2)}px, ${(top - box.top).toFixed(2)}px) scale(${scale.toFixed(4)})`
      card.style.clipPath = `path('${pathOf(inside)}')`
      edge.setAttribute('d', pathOf(points))
      edge.style.opacity = String(Math.max(0, 1 - grownBy / EDGE_GONE))
      ghost.style.opacity = String(Math.max(0, 1 - grownBy / GHOST_GONE))
    }
    const done = () => {
      Object.assign(card.style, kept)
      layer.remove()
      ghost.remove()
      finish()
    }
    pane.insertBefore(ghost, card)
    card.style.background = piece.ground
    card.style.pointerEvents = 'none'
    card.style.willChange = 'transform, clip-path'
    draw(0)
    arrive(true)
    let last = performance.now()
    const frame = (now: number) => {
      if (!card.isConnected) {
        done()
        return
      }
      step(progress, Math.max(0, (now - last) / 1000), GROWING)
      last = now
      draw(progress.at)
      if (resting(progress)) done()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }
  return { arrived: arriving.promise, grown: growing.promise }
}
