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
  notice?: boolean
  node?: Element
}

const NOTICES = '[data-notices]'
const CARDS = `${NOTICES} > *`

export const COVERS = {
  floating: ['orden-layer', 'orden-bubble', 'orden-screen', 'orden-swipe', 'orden-flight'],
  whole: ['orden-scrim', 'orden-swipe-room'],
} as const

const FLOATING = [
  ...COVERS.floating.map((one) => `.${one}`),
  '[data-covers]:not([data-covers="all"])',
  CARDS,
].join(', ')
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
  const over = layers.filter(
    (one) => one.box.width > 0 && one.box.height > 0 && meets(one.box, hole),
  )
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

const LEFT = 0.5

export function clearOf(hole: Rect, layers: readonly Layer[]): { box: Rect; layers: Layer[] } {
  const notices = layers.filter(
    (one) => one.notice && one.box.width > 0 && one.box.height > 0 && meets(one.box, hole),
  )
  if (notices.length === 0) return { box: hole, layers: [...layers] }

  const top = Math.min(...notices.map((one) => one.box.y))
  const height = Math.floor(top - hole.y)
  if (height < hole.height * LEFT) return { box: hole, layers: [...layers] }
  return {
    box: { ...hole, height },
    layers: layers.filter((one) => !notices.includes(one)),
  }
}

function boxOf(node: Element): Rect {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

function seen(node: Element): boolean {
  if (typeof node.checkVisibility !== 'function') return true
  return node.checkVisibility({ visibilityProperty: true })
}

export function layersOver(hole: HTMLElement): Layer[] {
  const found: Layer[] = []
  for (const node of document.querySelectorAll(ANY)) {
    if (hole.contains(node) || !seen(node)) continue
    const scrim = node.matches(SCRIMS)
    found.push({
      box: boxOf(node),
      radius: scrim ? 0 : parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0,
      scrim,
      notice: node.matches(CARDS),
      node,
    })
  }
  return found
}

export function moving(hole: HTMLElement): boolean {
  for (const node of document.querySelectorAll(ANY)) {
    if (hole.contains(node)) continue
    if (node.getAnimations().some((one) => one.playState === 'running')) return true
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

export function bringsLayer(
  record: Pick<MutationRecord, 'target' | 'addedNodes' | 'removedNodes'> & {
    type?: MutationRecordType
  },
): boolean {
  if (record.type === 'attributes') {
    const on = record.target
    return on instanceof Element && (on.matches(ANY) || on.querySelector(ANY) !== null)
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

const SHOWN_BY = ['class', 'style', 'hidden', 'data-covers']

const told = new Set<() => void>()
let arriving: MutationObserver | null = null

export function watchArrivals(tell: () => void): () => void {
  if (typeof MutationObserver !== 'function') return () => undefined
  told.add(tell)
  arriving ??= new MutationObserver((records) => {
    if (!records.some(bringsLayer)) return
    for (const one of told) one()
  })
  if (told.size === 1) {
    arriving.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: SHOWN_BY,
    })
  }
  return () => {
    told.delete(tell)
    if (told.size === 0) arriving?.disconnect()
  }
}
