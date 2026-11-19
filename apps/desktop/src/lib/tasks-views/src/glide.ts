import { cubicOut } from 'svelte/easing'
import { dur, slide } from '../../platform/src/api'

const GLIDE = 180
const EASE = 'cubic-bezier(0.215, 0.61, 0.355, 1)'
interface Point {
  x: number
  y: number
}
interface Place {
  seen: Point
  laid: Point
}
const going = new WeakMap<Element, Animation>()
function shifted(one: HTMLElement): Point {
  const parts = /^matrix\((.+)\)$/.exec(getComputedStyle(one).transform)?.[1]?.split(',').map(Number) ?? []
  return { x: parts[4] ?? 0, y: parts[5] ?? 0 }
}
function placesIn(root: HTMLElement, pick: string): Map<HTMLElement, Place> {
  const out = new Map<HTMLElement, Place>()
  for (const one of root.querySelectorAll<HTMLElement>(pick)) {
    const holder = one.parentElement
    if (!holder) continue
    const box = one.getBoundingClientRect()
    const around = holder.getBoundingClientRect()
    const by = shifted(one)
    const x = box.left - around.left
    const y = box.top - around.top
    out.set(one, { seen: { x, y }, laid: { x: x - by.x, y: y - by.y } })
  }
  return out
}
const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
export function glider(root: () => HTMLElement | null, picks: readonly string[]) {
  let was: Map<HTMLElement, Place>[] = []
  return {
    before(): void {
      const node = root()
      was = node && dur(GLIDE) > 0 ? picks.map((pick) => placesIn(node, pick)) : []
    },
    after(): void {
      const node = root()
      const then = was
      was = []
      if (!node) return
      picks.forEach((pick, at) => {
        const old = then[at]
        if (!old) return
        for (const [one, now] of placesIn(node, pick)) {
          const before = old.get(one)
          if (!before || near(before.laid, now.laid)) continue
          going.get(one)?.cancel()
          const from = `translate(${String(before.seen.x - now.laid.x)}px, ${String(before.seen.y - now.laid.y)}px)`
          going.set(
            one,
            one.animate([{ transform: from }, { transform: 'none' }], { duration: dur(GLIDE), easing: EASE }),
          )
        }
      })
    },
  }
}
export function away(node: Element) {
  const going = slide(node, { duration: dur(200), easing: cubicOut })
  const css = going.css
  return css ? { ...going, css: (t: number, u: number) => `${css(t, u)}; opacity: ${String(t)}` } : going
}
