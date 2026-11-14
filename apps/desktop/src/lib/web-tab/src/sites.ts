import { withOrWithout, isNumber, recordOf, Shared, stringList } from '../../platform/src/api'

const muted = new Shared('orden:web-muted', (value) => new Set(stringList(value) ?? []))
const zooms = new Shared('orden:web-zooms', (value) => recordOf(value, isNumber))

const asides = new Map<string, { muted: Map<string, boolean>; zooms: Map<string, number> }>()

function asideOf(tab: string) {
  let one = asides.get(tab)
  if (!one) {
    one = { muted: new Map(), zooms: new Map() }
    asides.set(tab, one)
  }
  return one
}

export function asideFor(tab: string, page: { inPrivate: boolean }): string | undefined {
  return page.inPrivate ? tab : undefined
}

export function isMuted(site: string, aside?: string): boolean {
  if (site === '') return false
  return asides.get(aside ?? '')?.muted.get(site) ?? muted.get().has(site)
}

export function setMuted(site: string, on: boolean, aside?: string): void {
  if (!site) return
  if (aside !== undefined) {
    asideOf(aside).muted.set(site, on)
    return
  }

  const all = new Set(muted.get())
  if (on) all.add(site)
  else all.delete(site)
  muted.set(all, JSON.stringify([...all]))
}

export function zoomOf(site: string, aside?: string): number {
  return asides.get(aside ?? '')?.zooms.get(site) ?? zooms.get()[site] ?? 1
}

export function keepZoom(site: string, factor: number, aside?: string): void {
  if (!site || !Number.isFinite(factor) || factor <= 0) return

  const round = Math.round(factor * 100) / 100
  if (aside !== undefined) {
    asideOf(aside).zooms.set(site, round)
    return
  }

  const all = withOrWithout(zooms.get(), site, round === 1 ? null : round)
  zooms.set(all, JSON.stringify(all))
}

export function forgetAside(tab: string): void {
  asides.delete(tab)
}

export function reread(): void {
  muted.drop()
  zooms.drop()
  asides.clear()
}
