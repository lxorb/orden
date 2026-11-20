import type { Rect } from './pages.svelte'

interface Hollow extends Rect {
  radius: number
}
export interface Cut {
  all: boolean
  hollows: Hollow[]
}
export interface Layer {
  box: Rect
  radius: number
  scrim: boolean
  node?: Element
}
const NOTICES = '[data-notices]'
const CARDS = `${NOTICES} > *`
export const COVERS = {
  floating: ['orden-layer', 'orden-bubble', 'orden-screen', 'orden-swipe', 'orden-flight'],
  whole: ['orden-scrim', 'orden-swipe-room'],
} as const
const FLOATING = [...COVERS.floating.map((one) => `.${one}`), '[data-covers]:not([data-covers="all"])', CARDS].join(
  ', ',
)
const SCRIMS = [...COVERS.whole.map((one) => `.${one}`), '[data-covers="all"]'].join(', ')
const ANY = `${FLOATING}, ${SCRIMS}`
function meets(one: Rect, other: Rect): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  )
}
export function cutOf(hole: Rect, layers: readonly Layer[]): Cut | null {
  const over = layers.filter((one) => one.box.width > 0 && one.box.height > 0 && meets(one.box, hole))
  if (over.length === 0) return null
  return {
    all: over.some((one) => one.scrim),
    hollows: over
      .filter((one) => !one.scrim)
      .map((one) => ({
        x: one.box.x - hole.x,
        y: one.box.y - hole.y,
        width: one.box.width,
        height: one.box.height,
        radius: one.radius,
      })),
  }
}
export const ALL: Cut = { all: true, hollows: [] }
export function settled(cut: Cut | null, pictured: boolean, cuts: boolean): Cut | null {
  return cut?.all && (pictured || !cuts) ? ALL : cut
}
export function boxOf(node: Element): Rect {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}
function joined(one: Rect, other: Rect): Rect {
  if (one.width <= 0 || one.height <= 0) return other
  if (other.width <= 0 || other.height <= 0) return one
  const x = Math.min(one.x, other.x)
  const y = Math.min(one.y, other.y)
  const right = Math.max(one.x + one.width, other.x + other.width)
  const bottom = Math.max(one.y + one.height, other.y + other.height)
  return { x, y, width: right - x, height: bottom - y }
}
function running(): Animation[] {
  if (typeof document.getAnimations !== 'function') return []
  return document.getAnimations().filter((one) => one.playState === 'running')
}
function targetOf(one: Animation): Element | null {
  const effect = one.effect as KeyframeEffect | null
  const on = effect?.target
  return on instanceof Element && !effect?.pseudoElement ? on : null
}
function moves(node: Element, among: readonly Animation[]): Animation[] {
  return among.filter((one) => targetOf(one)?.contains(node) === true)
}
const TIMING = new Set(['offset', 'computedOffset', 'easing', 'composite'])
function endOf(one: Animation): Keyframe | null {
  const effect = one.effect as KeyframeEffect | null
  if (!effect || typeof effect.getKeyframes !== 'function') return null
  if (!Number.isFinite(Number(effect.getComputedTiming().endTime))) return null
  const frames = effect.getKeyframes()
  const last = one.playbackRate < 0 ? frames[0] : frames.at(-1)
  if (!last) return null
  return Object.fromEntries(Object.entries(last).filter(([key]) => !TIMING.has(key)))
}
function restingBox(node: Element, among: readonly Animation[] = running()): Rect {
  const now = boxOf(node)
  const ended: Animation[] = []
  for (const one of moves(node, among)) {
    const end = endOf(one)
    const on = targetOf(one)
    if (end && on && typeof on.animate === 'function') ended.push(on.animate([end], { fill: 'forwards' }))
  }
  if (ended.length === 0) return now
  const rest = boxOf(node)
  for (const one of ended) one.cancel()
  return joined(now, rest)
}
export const TRAIL = 120
const trails = new WeakMap<Element, { at: number; box: Rect }[]>()
let movedAt = -Infinity
function same(one: Rect, other: Rect): boolean {
  return one.x === other.x && one.y === other.y && one.width === other.width && one.height === other.height
}
function trailed(node: Element, box: Rect): Rect {
  const now = Date.now()
  const kept = (trails.get(node) ?? []).filter((one) => now - one.at < TRAIL)
  const last = kept.at(-1)
  if (last && !same(last.box, box)) movedAt = now
  kept.push({ at: now, box })
  trails.set(node, kept)
  return kept.reduce((all, one) => joined(all, one.box), box)
}
function seen(node: Element): boolean {
  if (typeof node.checkVisibility !== 'function') return true
  return node.checkVisibility({ visibilityProperty: true })
}
export function layersOver(hole: HTMLElement): Layer[] {
  const found: Layer[] = []
  const among = running()
  for (const node of document.querySelectorAll(ANY)) {
    if (hole.contains(node) || !seen(node)) continue
    const scrim = node.matches(SCRIMS)
    found.push({
      box: trailed(node, restingBox(node, among)),
      radius: scrim ? 0 : parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0,
      scrim,
      node,
    })
  }
  return found
}
export function moving(hole: HTMLElement): boolean {
  if (Date.now() - movedAt < TRAIL) return true
  const among = running()
  if (among.length === 0) return false
  for (const node of document.querySelectorAll(ANY)) {
    if (hole.contains(node)) continue
    if (moves(node, among).length > 0) return true
  }
  return false
}
export function strangerOver(hole: HTMLElement): boolean {
  const box = hole.getBoundingClientRect()
  for (const x of [0.08, 0.5, 0.92]) {
    for (const y of [0.08, 0.5, 0.92]) {
      const on = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y)
      if (on === null || on === hole || hole.contains(on)) continue
      if (on.closest(ANY)) continue
      return true
    }
  }
  return false
}
export function noticeRows(): Element[] {
  return [...document.querySelectorAll(NOTICES)]
}
type Change = Pick<MutationRecord, 'target' | 'addedNodes' | 'removedNodes'> & {
  type?: MutationRecordType
  attributeName?: string | null
  oldValue?: string | null
}
const MARKS = new Set<string>([...COVERS.floating, ...COVERS.whole])
function wasLayer(record: Change): boolean {
  if (record.attributeName === 'data-covers') return true
  if (record.attributeName !== 'class' || !record.oldValue) return false
  return record.oldValue.split(/\s+/).some((one) => MARKS.has(one))
}
export function bringsLayer(record: Change): boolean {
  if (record.type === 'attributes') {
    const on = record.target
    if (!(on instanceof Element)) return false
    if (on.matches(ANY) || wasLayer(record)) return true
    return record.attributeName !== 'style' && on.querySelector(ANY) !== null
  }
  if (record.target instanceof Element && record.target.matches(NOTICES)) return true
  for (const nodes of [record.addedNodes, record.removedNodes]) {
    for (const node of nodes) {
      if (!(node instanceof Element)) continue
      if (node.matches(ANY) || node.querySelector(ANY) !== null) return true
    }
  }
  return false
}
const drawn = new WeakSet<Element>()
function layersIn(nodes: Iterable<Node>): Element[] {
  return [...nodes].flatMap((node) => {
    if (!(node instanceof Element)) return []
    const within = [...node.querySelectorAll(ANY)]
    return node.matches(ANY) ? [node, ...within] : within
  })
}
function arrivals(records: readonly Change[]): Element[] {
  for (const one of layersIn(records.flatMap((record) => [...record.removedNodes]))) drawn.delete(one)
  const touched = layersIn(
    records.flatMap((record) => (record.type === 'attributes' ? [record.target] : [...record.addedNodes])),
  )
  const came: Element[] = []
  for (const one of new Set(touched)) {
    if (!one.isConnected || !seen(one)) {
      drawn.delete(one)
      continue
    }
    if (!drawn.has(one)) came.push(one)
    drawn.add(one)
  }
  return came
}
export const HOLDS_AT_MOST = 150
export const HELD = 'data-covers-held'
function holdRule(): void {
  if (document.getElementById(HELD)) return
  const rule = Object.assign(document.createElement('style'), { id: HELD })
  rule.textContent = `[${HELD}] { clip-path: inset(50%) !important; }`
  document.head.append(rule)
}
function hold(nodes: readonly Element[], owed: readonly Promise<unknown>[]): void {
  const fresh = nodes.filter((one) => !one.hasAttribute(HELD))
  if (fresh.length === 0) return
  holdRule()
  for (const one of fresh) one.setAttribute(HELD, '')
  let free = (): void => undefined
  const waited = new Promise<void>((go) => (free = go))
  const cap = setTimeout(free, HOLDS_AT_MOST)
  void Promise.race([Promise.allSettled(owed), waited]).then(() => {
    clearTimeout(cap)
    for (const one of fresh) one.removeAttribute(HELD)
  })
}
let hushed = false
export function hushArrivals(on: boolean): void {
  hushed = on
}
const SHOWN_BY = ['class', 'style', 'hidden', 'data-covers']
const told = new Set<() => unknown>()
let arriving: MutationObserver | null = null
export function watchArrivals(tell: () => unknown): () => void {
  if (typeof MutationObserver !== 'function') return () => undefined
  told.add(tell)
  arriving ??= new MutationObserver((records) => {
    if (hushed || !records.some(bringsLayer)) return
    const came = arrivals(records)
    const owed = [...told].map((one) => one()).filter((one): one is Promise<unknown> => one instanceof Promise)
    if (owed.length > 0 && came.length > 0) hold(came, owed)
  })
  if (told.size === 1) {
    arriving.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: SHOWN_BY,
    })
  }
  return () => {
    told.delete(tell)
    if (told.size === 0) arriving?.disconnect()
  }
}
