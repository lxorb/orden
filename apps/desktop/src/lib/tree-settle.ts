import { tick } from 'svelte'
import { dur } from './platform/src/api'

const SETTLING = 180

export function anchorShift(
  was: readonly string[],
  now: ReadonlyMap<string, number>,
  first: number,
  last: number,
): number {
  const from = Math.max(0, first)
  const to = Math.min(was.length - 1, last)
  for (let index = from; index <= to; index++) {
    const id = was[index]
    const here = id === undefined ? undefined : now.get(id)
    if (here === undefined) continue
    const shift = here - index
    if (from === to) return shift
    const next = was[index + 1]
    const there = next === undefined ? undefined : now.get(next)
    if (index < to && (there === undefined || there - (index + 1) === shift)) return shift
  }
  return 0
}

export function indexed(ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>()
  ids.forEach((id, index) => out.set(id, index))
  return out
}

export interface Settling {
  list: HTMLElement
  box: HTMLElement
  row: number
  top: number
  refresh: () => void
}

function rowsIn(list: HTMLElement): [string, HTMLElement][] {
  const out: [string, HTMLElement][] = []
  for (const line of list.querySelectorAll<HTMLElement>('li[data-id]')) {
    const id = line.dataset.id
    if (id === undefined) continue
    out.push([id, line.querySelector<HTMLElement>('.row') ?? line])
  }
  return out
}

export function settle(was: readonly string[], now: readonly string[], at: Settling): void {
  const { list, box, row } = at
  if (!was.length || row <= 0) return

  const nowAt = indexed(now)
  const wasAt = indexed(was)
  const first = Math.floor(Math.max(0, at.top) / row)
  const last = Math.floor((Math.max(0, at.top) + box.clientHeight) / row)
  const shift = at.top > 0 ? anchorShift(was, nowAt, first, last) : 0

  const moving = dur(SETTLING) > 0 && typeof list.animate === 'function'
  const listTop = list.getBoundingClientRect().top
  const placed = new Map<string, number>()
  if (moving) for (const [id, one] of rowsIn(list)) placed.set(id, one.getBoundingClientRect().top)

  void tick().then(async () => {
    if (shift !== 0) {
      box.scrollTop += shift * row
      at.refresh()
      await tick()
    }
    if (!moving) return

    const room = box.clientHeight
    for (const [id, one] of rowsIn(list)) {
      const top = one.getBoundingClientRect().top
      const index = wasAt.get(id)
      const before = placed.get(id) ?? (index === undefined ? undefined : listTop + index * row)
      if (before === undefined) {
        one.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: dur(SETTLING),
          easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
        })
        continue
      }
      const from = Math.max(-room, Math.min(room, before - top))
      if (Math.abs(from) < 0.5) continue
      if (typeof one.getAnimations === 'function') {
        for (const running of one.getAnimations()) running.cancel()
      }
      one.animate([{ transform: `translateY(${String(from)}px)` }, { transform: 'none' }], {
        duration: dur(SETTLING),
        easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
      })
    }
  })
}
