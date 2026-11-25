import { type Shape, SHAPES, shapeOf } from './bibata'

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
const PEN = 'M4 28 L7 19 L22 4 L28 10 L13 25 Z M7 19 L13 25'
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
const SIZE = 48
const SVG = 'http://www.w3.org/2000/svg'
const AI_BODY = '#7c6bf5'
const dark = () => document.documentElement.dataset.theme !== 'light'
export class Pointer {
  private readonly root = document.createElement('div')
  private readonly ring = document.createElement('div')
  private readonly shapes = new Map<Shape, SVGSVGElement>()
  private shown = ''
  private shape: Shape = 'arrow'
  private painted = ''
  private last: Point | null = null
  constructor(
    private readonly look: Look,
    label?: string,
  ) {
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
      border: `3px solid ${AI_BODY}`,
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
    } else if (look === 'pen') {
      const svg = document.createElementNS(SVG, 'svg')
      svg.setAttribute('width', '44')
      svg.setAttribute('height', '44')
      svg.setAttribute('viewBox', '0 0 32 32')
      Object.assign(svg.style, {
        position: 'absolute',
        left: '-5.5px',
        top: '-38.5px',
        overflow: 'visible',
        filter: 'drop-shadow(0 2px 3px rgb(0 0 0 / 0.35))',
      })
      const path = document.createElementNS(SVG, 'path')
      path.setAttribute('d', PEN)
      path.setAttribute('fill', '#ffffff')
      path.setAttribute('stroke', '#111318')
      path.setAttribute('stroke-width', '2')
      path.setAttribute('stroke-linejoin', 'round')
      svg.append(path)
      this.root.append(svg)
    } else
      for (const [name, { hot, parts }] of Object.entries(SHAPES) as [Shape, (typeof SHAPES)[Shape]][]) {
        const svg = document.createElementNS(SVG, 'svg')
        svg.setAttribute('width', String(SIZE))
        svg.setAttribute('height', String(SIZE))
        svg.setAttribute('viewBox', '0 0 256 256')
        Object.assign(svg.style, {
          position: 'absolute',
          left: `${(-hot[0] * SIZE) / 256}px`,
          top: `${(-hot[1] * SIZE) / 256}px`,
          overflow: 'visible',
          display: name === 'arrow' ? 'block' : 'none',
          filter: 'drop-shadow(0 2px 3px rgb(0 0 0 / 0.3))',
        })
        for (const part of parts) {
          const path = document.createElementNS(SVG, 'path')
          path.setAttribute('d', part.d)
          path.dataset.fill = part.fill
          if (part.outlined) {
            path.setAttribute('stroke-width', '17')
            path.dataset.outlined = 'yes'
          }
          svg.append(path)
        }
        this.shapes.set(name, svg)
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
        background: AI_BODY,
        color: '#ffffff',
        font: '600 13px/1.4 system-ui, sans-serif',
        whiteSpace: 'nowrap',
      })
      this.root.append(tag)
    }
    this.paint()
    document.body.append(this.root)
  }
  private paint(): void {
    const body = this.look === 'ai' ? AI_BODY : dark() ? '#ffffff' : '#000000'
    const edge = this.look === 'ai' || !dark() ? '#ffffff' : '#000000'
    const key = `${body}${edge}`
    if (key === this.painted) return
    this.painted = key
    for (const svg of this.shapes.values())
      for (const path of svg.querySelectorAll<SVGPathElement>('path')) {
        path.setAttribute('fill', path.dataset.fill === 'edge' ? edge : body)
        if (path.dataset.outlined) path.setAttribute('stroke', edge)
      }
  }
  private reshape(at: Point): void {
    if (!this.shapes.size) return
    const under = document.elementFromPoint(at.x, at.y)
    const next = shapeOf(under ? getComputedStyle(under).cursor : 'auto', under)
    if (next === this.shape) return
    this.shapes.get(this.shape)?.style.setProperty('display', 'none')
    this.shapes.get(next)?.style.setProperty('display', 'block')
    this.shape = next
  }
  where(): Point | null {
    return this.last
  }
  show(at: Point | null, press = 0): void {
    this.last = at
    const key = at ? `${Math.round(at.x)},${Math.round(at.y)},${press.toFixed(2)}` : ''
    if (key === this.shown) return
    this.shown = key
    if (!at) {
      this.root.style.display = 'none'
      return
    }
    this.paint()
    this.reshape(at)
    this.root.style.display = 'block'
    this.root.style.transform = `translate(${at.x}px, ${at.y}px) scale(${1 - 0.12 * press})`
    this.ring.style.opacity = String(press)
    this.ring.style.transform = `scale(${1.6 - 0.6 * press})`
  }
}
