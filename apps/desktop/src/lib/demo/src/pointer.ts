export interface Point {
  x: number
  y: number
}
export interface Stop {
  at: number
  to: () => Point | null
  press?: boolean
}
export type Look = 'user' | 'ai' | 'touch' | 'pen'
const ARROW = 'M3 2 L3 25 L9.2 19.2 L13.4 28.6 L17.6 26.8 L13.5 17.6 L22 17.6 Z'
const PEN = 'M4 28 L7 19 L22 4 L28 10 L13 25 Z M7 19 L13 25'
const PRESS = 0.035
const ease = (value: number) => value * value * (3 - 2 * value)
export function placeAt(phase: number, stops: readonly Stop[]): { at: Point | null; press: number } {
  let from = -1
  for (let index = 0; index < stops.length; index++) if ((stops[index]?.at ?? 2) <= phase) from = index
  const before = stops[from]
  const after = stops[from + 1]
  const start = before?.to() ?? null
  let at = start
  if (before && after) {
    const end = after.to()
    const span = after.at - before.at
    const moving = ease(Math.min(1, Math.max(0, (phase - before.at) / Math.max(0.001, span * 0.7))))
    if (start && end) at = { x: start.x + (end.x - start.x) * moving, y: start.y + (end.y - start.y) * moving }
    else at = end ?? start
  }
  const pressed = stops.find((one) => one.press && phase >= one.at && phase < one.at + PRESS)
  return { at, press: pressed ? 1 - (phase - pressed.at) / PRESS : 0 }
}
export function boxOf(selector: string, inside: ParentNode = document): Point | null {
  const found = inside.querySelector(selector)
  if (!found) return null
  const box = found.getBoundingClientRect()
  return box.width || box.height ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null
}
export function onPlane(host: string, camera: { x: number; y: number; scale: number }, point: Point): Point | null {
  const found = document.querySelector(host)
  if (!found) return null
  const box = found.getBoundingClientRect()
  return {
    x: box.left + box.width / 2 + (point.x - camera.x) * camera.scale,
    y: box.top + box.height / 2 + (point.y - camera.y) * camera.scale,
  }
}
export class Pointer {
  private readonly root = document.createElement('div')
  private readonly ring = document.createElement('div')
  private shown = ''
  constructor(look: Look, label?: string) {
    const ink = look === 'ai' ? '#7c6bf5' : '#ffffff'
    const edge = look === 'ai' ? '#ffffff' : '#111318'
    this.root.setAttribute('aria-hidden', 'true')
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      willChange: 'transform',
      display: 'none',
    })
    Object.assign(this.ring.style, {
      position: 'absolute',
      left: '-30px',
      top: '-30px',
      width: '60px',
      height: '60px',
      borderRadius: '50%',
      border: `3px solid ${look === 'ai' ? ink : '#7c6bf5'}`,
      opacity: '0',
    })
    this.root.append(this.ring)
    if (look === 'touch') {
      const dot = document.createElement('div')
      Object.assign(dot.style, {
        position: 'absolute',
        left: '-17px',
        top: '-17px',
        width: '34px',
        height: '34px',
        borderRadius: '50%',
        background: 'rgb(255 255 255 / 0.7)',
        border: '3px solid #111318',
        boxShadow: '0 2px 8px rgb(0 0 0 / 0.35)',
      })
      this.root.append(dot)
    } else {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '44')
      svg.setAttribute('height', '44')
      svg.setAttribute('viewBox', '0 0 32 32')
      Object.assign(svg.style, {
        position: 'absolute',
        left: look === 'pen' ? '-5.5px' : '-4px',
        top: look === 'pen' ? '-38.5px' : '-3px',
        overflow: 'visible',
        filter: 'drop-shadow(0 2px 3px rgb(0 0 0 / 0.35))',
      })
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', look === 'pen' ? PEN : ARROW)
      path.setAttribute('fill', ink)
      path.setAttribute('stroke', edge)
      path.setAttribute('stroke-width', '2')
      path.setAttribute('stroke-linejoin', 'round')
      svg.append(path)
      this.root.append(svg)
    }
    if (label) {
      const tag = document.createElement('div')
      tag.textContent = label
      Object.assign(tag.style, {
        position: 'absolute',
        left: '34px',
        top: '30px',
        padding: '2px 8px',
        borderRadius: '8px',
        background: ink,
        color: edge,
        font: '600 13px/1.4 system-ui, sans-serif',
        whiteSpace: 'nowrap',
      })
      this.root.append(tag)
    }
    document.body.append(this.root)
  }
  show(at: Point | null, press = 0): void {
    const key = at ? `${Math.round(at.x)},${Math.round(at.y)},${press.toFixed(2)}` : ''
    if (key === this.shown) return
    this.shown = key
    if (!at) {
      this.root.style.display = 'none'
      return
    }
    this.root.style.display = 'block'
    this.root.style.transform = `translate(${at.x}px, ${at.y}px) scale(${1 - 0.12 * press})`
    this.ring.style.opacity = String(press)
    this.ring.style.transform = `scale(${1.6 - 0.6 * press})`
  }
}
