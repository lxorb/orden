import { t } from '../i18n.svelte'
import { dur, stillness } from '../motion'
import { workspace } from '../workspace.svelte'

const FLIGHT = 720
const TRAIL = 70

const SAID = 1800

const SPARK =
  'M8 0.5c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5 3.6-.5 5-1.9 5.5-5.5z'

interface Point {
  x: number
  y: number
}

function seen(element: Element | null, y?: number): Point | null {
  if (!(element instanceof HTMLElement)) return null
  const box = element.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  const at = {
    x: box.left + box.width / 2,
    y: y === undefined ? box.top + box.height / 2 : box.top + y,
  }
  const top = document.elementFromPoint(at.x, at.y)
  return top && element.contains(top) ? at : null
}

function landing(): { at: Point; mark: HTMLElement | null } {
  const side = workspace.sideOf('ask')
  const list = seen(document.querySelector('[data-sidebar] .body[data-panel="ask"]'), 28)
  if (list) return { at: list, mark: null }
  for (const mark of [
    document.querySelector('[data-sidebar] [data-tab="ask"]'),
    document.querySelector(`[data-side-toggle="${side}"]`),
  ]) {
    const at = seen(mark)
    if (at && mark instanceof HTMLElement) return { at, mark }
  }
  return { at: { x: side === 'right' ? window.innerWidth - 24 : 24, y: 24 }, mark: null }
}

const EDGE = 12

function within(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), most)
}

function arc(from: Point, to: Point, steps = 18): Keyframe[] {
  const far = Math.hypot(to.x - from.x, to.y - from.y) || 1
  const bow = Math.min(140, far * 0.35)
  const bend = {
    x: within((from.x + to.x) / 2 + ((to.y - from.y) / far) * bow, EDGE, window.innerWidth - EDGE),
    y: within((from.y + to.y) / 2 - ((to.x - from.x) / far) * bow, EDGE, window.innerHeight - EDGE),
  }
  const frames: Keyframe[] = []
  for (let step = 0; step <= steps; step++) {
    const at = step / steps
    const x = (1 - at) ** 2 * from.x + 2 * (1 - at) * at * bend.x + at ** 2 * to.x
    const y = (1 - at) ** 2 * from.y + 2 * (1 - at) * at * bend.y + at ** 2 * to.y
    const scale = 1.25 - 0.6 * at
    frames.push({
      transform: `translate(${x - 8}px, ${y - 8}px) scale(${scale}) rotate(${at * 200}deg)`,
      opacity: at < 0.85 ? 1 : (1 - at) / 0.15,
    })
  }
  return frames
}

function spark(size: number, glow: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  Object.assign(svg.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${size}px`,
    height: `${size}px`,
    pointerEvents: 'none',
    zIndex: '10000',
    fill: 'var(--accent)',
    filter: glow ? 'drop-shadow(0 0 6px var(--accent))' : 'none',
    willChange: 'transform, opacity',
  })
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', SPARK)
  svg.append(path)
  return svg
}

function say(from: DOMRect): void {
  const line = document.createElement('div')
  line.setAttribute('role', 'status')
  line.textContent = t('Started in the AI panel')
  Object.assign(line.style, {
    position: 'fixed',
    top: `${from.bottom + 6}px`,
    left: '0',
    padding: '3px 9px',
    borderRadius: '999px',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    font: '500 12px/1.4 var(--font-ui)',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    zIndex: '10000',
    boxShadow: '0 4px 14px rgb(0 0 0 / 0.18)',
  })
  document.body.append(line)
  const wide = line.getBoundingClientRect().width
  const left = within(from.left + from.width / 2 - wide / 2, EDGE, window.innerWidth - wide - EDGE)
  line.style.left = `${left}px`
  if (stillness()) {
    setTimeout(() => line.remove(), SAID)
    return
  }
  const shows = line.animate(
    [
      { opacity: 0, transform: 'translateY(-4px)' },
      { opacity: 1, transform: 'none', offset: 0.1 },
      { opacity: 1, transform: 'none', offset: 0.9 },
      { opacity: 0, transform: 'none' },
    ],
    { duration: dur(SAID), easing: 'ease-out' },
  )
  void shows.finished.finally(() => line.remove())
}

function press(button: HTMLElement): void {
  if (stillness()) return
  button.animate(
    [
      { transform: 'scale(1) rotate(0deg)' },
      { transform: 'scale(1.3) rotate(-12deg)', offset: 0.35 },
      { transform: 'scale(1) rotate(0deg)' },
    ],
    { duration: dur(420), easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  )
}

function land(at: Point, mark: HTMLElement | null): void {
  const ring = document.createElement('div')
  Object.assign(ring.style, {
    position: 'fixed',
    left: `${at.x - 14}px`,
    top: `${at.y - 14}px`,
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid var(--accent)',
    pointerEvents: 'none',
    zIndex: '10000',
  })
  document.body.append(ring)
  const opens = ring.animate(
    [
      { transform: 'scale(0.3)', opacity: 0.9 },
      { transform: 'scale(1.6)', opacity: 0 },
    ],
    { duration: dur(520), easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  )
  void opens.finished.finally(() => ring.remove())
  mark?.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.18)', offset: 0.4 },
      { transform: 'scale(1)' },
    ],
    { duration: dur(380), easing: 'ease-out' },
  )
}

export function sentOff(button: HTMLElement): void {
  const from = button.getBoundingClientRect()
  say(from)
  press(button)
  if (stillness()) return

  const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 }
  const { at, mark } = landing()
  const frames = arc(start, at)
  const sparks = [spark(16, true), spark(10, false), spark(7, false)]
  sparks.forEach((one, index) => {
    document.body.append(one)
    const flies = one.animate(frames, {
      duration: dur(FLIGHT),
      delay: index * TRAIL,
      easing: 'cubic-bezier(0.45, 0, 0.25, 1)',
      fill: 'backwards',
    })
    one.style.opacity = '0'
    if (index > 0) one.style.filter = `opacity(${0.7 - index * 0.2})`
    void flies.finished.finally(() => {
      one.remove()
      if (index === 0) land(at, mark)
    })
  })
}
