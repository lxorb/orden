import { keepJson, stored } from './platform/src/api'
import type { TabKind } from './workspace/tab-kinds'

const STORE = 'orden:kept-scroll'

export const SCROLL_KEPT: ReadonlySet<TabKind> = new Set<TabKind>([
  'settings',
  'pass',
  'time',
  'explorer',
  'view',
  'channel',
])

interface Showing {
  readonly kind: TabKind
  readonly path: string | null
  readonly reading: boolean
}

export function scrollKeyOf(tab: Showing | null | undefined, slot: number): string | null {
  if (!tab || tab.reading || !SCROLL_KEPT.has(tab.kind)) return null
  return `${slot}:${tab.kind}:${tab.path ?? ''}`
}
const MOST = 400
const PATIENCE = 90
const HANDS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

let kept: Map<string, number> | null = null
let writing: ReturnType<typeof setTimeout> | undefined

function all(): Map<string, number> {
  if (kept) return kept
  const read = new Map<string, number>()
  const said = stored(STORE)
  if (Array.isArray(said)) {
    for (const one of said as unknown[]) {
      if (!Array.isArray(one)) continue
      const [place, top] = one as unknown[]
      if (typeof place === 'string' && typeof top === 'number' && Number.isFinite(top) && top > 0) {
        read.set(place, top)
      }
    }
  }
  kept = read
  return read
}

function written() {
  clearTimeout(writing)
  writing = setTimeout(() => {
    writing = undefined
    keepJson(STORE, [...all()])
  }, 300)
}

export function keptScroll(place: string): number | undefined {
  return all().get(place)
}

function keepScroll(place: string, top: number) {
  const map = all()
  const was = map.get(place)
  const now = Math.round(top)
  if (was === now || (was === undefined && now <= 0)) return
  map.delete(place)
  if (now > 0) map.set(place, now)
  while (map.size > MOST) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
  written()
}

export function forgetKeptScrolls() {
  clearTimeout(writing)
  writing = undefined
  kept = null
}

function named(element: Element): string | undefined {
  return element instanceof HTMLElement ? element.dataset.scrollKey : undefined
}

function sort(element: Element): string {
  return `${element.tagName.toLowerCase()}.${element.classList[0] ?? ''}`
}

function step(element: Element): string {
  const own = named(element)
  if (own !== undefined) return `${sort(element)}[${own}]`
  let at = 0
  for (let one = element.previousElementSibling; one; one = one.previousElementSibling) {
    if (sort(one) === sort(element) && named(one) === undefined) at += 1
  }
  return `${sort(element)}:${at}`
}

function placeOf(root: Element, element: Element): string | null {
  const steps: string[] = []
  let one: Element | null = element
  while (one && one !== root) {
    steps.push(step(one))
    one = one.parentElement
  }
  return one === root && steps.length ? steps.reverse().join('/') : null
}

function foundAt(root: Element, place: string): HTMLElement | null {
  let one: Element = root
  for (const wanted of place.split('/')) {
    const next = [...one.children].find((child) => step(child) === wanted)
    if (!next) return null
    one = next
  }
  return one instanceof HTMLElement ? one : null
}

const held = new WeakSet<Element>()

export function holdScroll(element: Element) {
  held.add(element)
}

function own(element: Element): boolean {
  return element.closest('[data-own-scroll]') !== null
}

export function keepsScroll(root: HTMLElement, key: string | null) {
  let at = key
  const placed = new Map<string, Element>()
  const restoring = new Map<Element, number>()
  let looking = 0

  const stop = (element: Element) => {
    const frame = restoring.get(element)
    if (frame) cancelAnimationFrame(frame)
    restoring.delete(element)
  }

  const stopAll = () => {
    for (const element of [...restoring.keys()]) stop(element)
  }

  const restore = (element: HTMLElement, want: number) => {
    stop(element)
    let frames = 0
    const tried = () => {
      if (!element.isConnected || held.has(element)) {
        stop(element)
        return
      }
      element.scrollTop = want
      frames += 1
      if (Math.abs(element.scrollTop - want) < 1 || frames >= PATIENCE) {
        stop(element)
        return
      }
      restoring.set(element, requestAnimationFrame(tried))
    }
    restoring.set(element, 0)
    tried()
  }

  const look = () => {
    looking = 0
    if (at === null) return
    const prefix = `${at}|`
    for (const [place, element] of [...placed]) {
      if (!element.isConnected || foundAt(root, place) !== element) placed.delete(place)
    }
    for (const [whole, top] of [...all()]) {
      if (!whole.startsWith(prefix)) continue
      const place = whole.slice(prefix.length)
      const element = foundAt(root, place)
      if (!element || placed.get(place) === element || own(element)) continue
      placed.set(place, element)
      if (held.has(element)) {
        held.delete(element)
        continue
      }
      restore(element, top)
    }
  }

  const soon = () => {
    if (looking || at === null) return
    looking = requestAnimationFrame(look)
  }

  const scrolled = (event: Event) => {
    const target = event.target
    if (at === null || !(target instanceof HTMLElement) || restoring.has(target) || own(target))
      return
    const place = placeOf(root, target)
    if (place === null) return
    held.delete(target)
    placed.set(place, target)
    keepScroll(`${at}|${place}`, target.scrollTop)
  }

  const watching = new MutationObserver(soon)
  const watch = () => {
    watching.disconnect()
    if (at === null) return
    watching.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-scroll-key'],
    })
    soon()
  }

  root.addEventListener('scroll', scrolled, { capture: true, passive: true })
  for (const hand of HANDS) root.addEventListener(hand, stopAll, { capture: true, passive: true })
  watch()

  return {
    update(next: string | null) {
      if (next === at) return
      at = next
      placed.clear()
      stopAll()
      watch()
    },
    destroy() {
      watching.disconnect()
      if (looking) cancelAnimationFrame(looking)
      stopAll()
      root.removeEventListener('scroll', scrolled, { capture: true })
      for (const hand of HANDS) root.removeEventListener(hand, stopAll, { capture: true })
    },
  }
}
