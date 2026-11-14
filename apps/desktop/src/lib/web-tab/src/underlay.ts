import type { Rect } from './pages.svelte'

export interface Hollow extends Rect {
  corner: number
  cut?: boolean
}

const PAINTERS = ['body', 'main', 'main > .middle', '[data-pane]'] as const

const holes = new Map<string, Hollow>()

const given = new Map<HTMLElement, string>()

const ATTRIBUTE = 'data-underlay'
const SLACK = 0.5

function n(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export function rounded(box: Rect, round: number, bottomOnly: boolean): string {
  const r = Math.max(0, Math.min(round, box.width / 2, box.height / 2))
  const [l, t, rt, b] = [box.x, box.y, box.x + box.width, box.y + box.height]
  const top = bottomOnly ? 0 : r
  return [
    `M${n(l + top)} ${n(t)}`,
    `H${n(rt - top)}`,
    top > 0 ? `A${n(top)} ${n(top)} 0 0 1 ${n(rt)} ${n(t + top)}` : '',
    `V${n(b - r)}`,
    r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(rt - r)} ${n(b)}` : '',
    `H${n(l + r)}`,
    r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(l)} ${n(b - r)}` : '',
    `V${n(t + top)}`,
    top > 0 ? `A${n(top)} ${n(top)} 0 0 1 ${n(l + top)} ${n(t)}` : '',
    'Z',
  ].join('')
}

function inside(hole: Rect, box: Rect): boolean {
  return (
    hole.x >= box.x - SLACK &&
    hole.y >= box.y - SLACK &&
    hole.x + hole.width <= box.x + box.width + SLACK &&
    hole.y + hole.height <= box.y + box.height + SLACK
  )
}

export function groundOf(box: Rect, round: number, pages: readonly Hollow[]): string | null {
  const within = pages.filter((one) => one.width > 0 && one.height > 0 && inside(one, box))
  if (within.length === 0) return null
  const local = (one: Rect): Rect => ({ ...one, x: one.x - box.x, y: one.y - box.y })
  const outer = rounded(local({ ...box }), round, false)
  const cut = within
    .filter((one) => one.cut !== false)
    .map((one) => rounded(local(one), one.corner, true))
  return `path(evenodd, "${[outer, ...cut].join(' ')}")`
}

function cutWithin(box: Rect, pages: readonly Hollow[]): boolean {
  return pages.some((one) => one.cut !== false && inside(one, box))
}

function boxOf(node: Element): Rect {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

function painters(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(PAINTERS.join(', '))]
}

function paint(): void {
  if (typeof document === 'undefined') return
  const all = [...holes.values()]
  const now = new Map<HTMLElement, Record<string, string>>()
  for (const one of all.length === 0 ? [] : painters()) {
    const box = boxOf(one)
    if (one.matches('[data-pane]') && !cutWithin(box, all)) continue
    const round = parseFloat(getComputedStyle(one).borderTopLeftRadius) || 0
    const shape = groundOf(box, round, all)
    if (!shape) continue
    now.set(one, {
      '--underlay-x': `${n(box.x)}px`,
      '--underlay-y': `${n(box.y)}px`,
      '--underlay-w': `${n(box.width)}px`,
      '--underlay-h': `${n(box.height)}px`,
      '--underlay-clip': shape,
    })
  }

  for (const [one, was] of given) {
    if (now.has(one)) continue
    one.removeAttribute(ATTRIBUTE)
    for (const name of Object.keys(JSON.parse(was) as Record<string, string>))
      one.style.removeProperty(name)
    given.delete(one)
  }
  for (const [one, props] of now) {
    const said = JSON.stringify(props)
    if (given.get(one) === said) continue
    for (const [name, value] of Object.entries(props)) one.style.setProperty(name, value)
    one.setAttribute(ATTRIBUTE, '')
    given.set(one, said)
  }
  document.documentElement.toggleAttribute(ATTRIBUTE, given.size > 0)
}

export function underlaid(tab: string, hole: Hollow | null): void {
  const was = holes.get(tab)
  if (hole === null) {
    if (!was) return
    holes.delete(tab)
  } else {
    holes.set(tab, hole)
  }
  paint()
}

export function opacityOf(hole: Element): number {
  if (
    typeof hole.checkVisibility === 'function' &&
    !hole.checkVisibility({ visibilityProperty: true })
  )
    return 0
  let shown = 1
  for (let at: Element | null = hole; at; at = at.parentElement) {
    const own = parseFloat(getComputedStyle(at).opacity)
    if (Number.isFinite(own)) shown *= own
  }
  return shown
}

export function fading(hole: Element): boolean {
  for (let at: Element | null = hole; at; at = at.parentElement) {
    if (typeof at.getAnimations !== 'function') return false
    if (at.getAnimations().some((one) => one.playState === 'running')) return true
  }
  return false
}
