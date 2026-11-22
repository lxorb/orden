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
  private last: Point | null = null
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
    this.root.style.display = 'block'
    this.root.style.transform = `translate(${at.x}px, ${at.y}px) scale(${1 - 0.12 * press})`
    this.ring.style.opacity = String(press)
    this.ring.style.transform = `scale(${1.6 - 0.6 * press})`
  }
}
