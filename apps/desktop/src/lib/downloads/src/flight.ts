import FileIcon from 'lucide/dist/esm/icons/file.mjs'
import { calm, dur, stillness } from '../../platform/src/api'
import { said } from '../../said.svelte'
import { lastPress, type Origin, type Press } from './api'
import {
  cornerOf,
  flightMs,
  framesOf,
  landing,
  middleOf,
  startOf,
  type Box,
  type Glyph,
  type Point,
} from './path'

const SIZE = 28

const AT_ONCE = 5

const APART = 70

function boxOf(node: Element): Box {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

function shown(node: Element | null | undefined): Box | null {
  if (!node?.isConnected) return null
  if (typeof node.checkVisibility === 'function' && !node.checkVisibility()) return null
  const box = boxOf(node)
  if (box.width === 0 || box.height === 0) return null
  if (box.x + box.width <= 0 || box.y + box.height <= 0) return null
  if (box.x >= innerWidth || box.y >= innerHeight) return null
  return box
}

const GLYPHS = '[data-opens="downloads"]'

function glyphsOnScreen(): { node: HTMLElement; glyph: Glyph }[] {
  const focusedPane = document.activeElement?.closest('[data-pane]') ?? null
  const found: { node: HTMLElement; glyph: Glyph }[] = []
  for (const node of document.querySelectorAll<HTMLElement>(GLYPHS)) {
    const box = shown(node)
    if (!box) continue
    found.push({
      node,
      glyph: {
        box,
        tab: node.dataset.tab ?? null,
        focused: focusedPane?.contains(node) === true,
      },
    })
  }
  return found
}

function areaOf(): Box {
  const panes = shown(document.querySelector('[data-panes]'))
  return panes ?? { x: 0, y: 0, width: innerWidth, height: innerHeight }
}

function pagesInWindow(): boolean {
  return document.querySelector('.webbar') !== null
}

async function engineCuts(): Promise<boolean> {
  if (!pagesInWindow()) return false
  const { pages } = await import('../../web-tab/pages.svelte')
  return pages.cuts
}

function pageOf(tab: string, cuts: boolean): Point | null {
  const glyph = [...document.querySelectorAll<HTMLElement>(GLYPHS)].find(
    (one) => one.dataset.tab === tab,
  )
  const pane = shown(glyph?.closest('[data-pane]'))
  if (!glyph || !pane) return null
  const bar = shown(glyph.closest('.webbar'))
  if (cuts || !bar) return middleOf(pane)
  return { x: pane.x + pane.width / 2, y: bar.y + bar.height }
}

const flying = new Set<Animation>()
const answering = new WeakMap<Element, Animation>()

function answer(node: Element): void {
  if (typeof node.animate !== 'function') return
  answering.get(node)?.cancel()
  const still = stillness()
  const frames: Keyframe[] = still
    ? [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }]
    : [
        { transform: 'scale(1)' },
        { transform: 'scale(1.25)', offset: 0.35 },
        { transform: 'scale(0.95)', offset: 0.7 },
        { transform: 'scale(1)' },
      ]
  const timing = still ? { duration: calm(480) } : { duration: dur(360) }
  answering.set(node, node.animate(frames, { ...timing, easing: 'ease-out' }))
}

function fileGlyph(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  for (const [tag, attrs] of FileIcon) {
    const part = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [name, value] of Object.entries(attrs)) part.setAttribute(name, String(value))
    svg.append(part)
  }
  Object.assign(svg.style, {
    width: '16px',
    height: '16px',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.75',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  })
  return svg
}

function flyer(at: Point, cut: boolean): HTMLElement {
  const node = document.createElement('div')
  if (cut) node.className = 'orden-flight'
  node.setAttribute('aria-hidden', 'true')
  node.dataset.flight = ''
  Object.assign(node.style, {
    position: 'fixed',
    left: `${String(at.x - SIZE / 2)}px`,
    top: `${String(at.y - SIZE / 2)}px`,
    width: `${String(SIZE)}px`,
    height: `${String(SIZE)}px`,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '8px',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    boxShadow: 'var(--shadow-md)',
    pointerEvents: 'none',
    zIndex: 'var(--z-carried)',
    opacity: '0',
    willChange: 'transform, opacity',
  })
  node.append(fileGlyph())
  return node
}

export function stopFlights(): void {
  for (const one of [...flying]) one.finish()
}

let listening = false
function listen() {
  if (listening) return
  listening = true
  window.addEventListener('resize', stopFlights, { passive: true })
}

function settled(): Promise<void> {
  return new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()))
  })
}

export async function started(
  name: string,
  from: Origin,
  press: Press | null = lastPress(),
): Promise<void> {
  said.say(`Downloading ${name}`)
  const element = shown(from.element)
  await settled()
  const cuts = await engineCuts()

  const glyphs = glyphsOnScreen()
  const target = landing(
    glyphs.map((one) => one.glyph),
    from.tab ?? null,
  )
  const node = target ? glyphs.find((one) => one.glyph === target)?.node : undefined

  if (stillness() || typeof document.body.animate !== 'function') {
    if (node) answer(node)
    return
  }
  if (flying.size >= AT_ONCE) {
    if (node) answer(node)
    return
  }

  const page = from.tab
    ? (pageOf(from.tab, cuts) ??
      (target?.tab ? pageOf(target.tab, cuts) : null) ??
      middleOf(areaOf()))
    : null
  const start = startOf({
    element,
    page,
    press,
    pressed: shown(press?.target),
    now: performance.now(),
    area: areaOf(),
  })
  const end = target ? middleOf(target.box) : cornerOf({ width: innerWidth, height: innerHeight })

  listen()
  const card = flyer(start, cuts)
  document.body.append(card)
  const flight = card.animate(framesOf(start, end, target !== null), {
    duration: dur(flightMs(start, end)),
    delay: flying.size * APART,
    easing: 'linear',
    fill: 'backwards',
  })
  flying.add(flight)

  const done = () => {
    flying.delete(flight)
    card.remove()
  }
  flight.onfinish = () => {
    done()
    if (node?.isConnected) answer(node)
  }
  flight.oncancel = done
}
