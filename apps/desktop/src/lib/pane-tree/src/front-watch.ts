import { webPages } from '@orden/contracts'
import { log } from '../../platform/src/api'
import { tabOverview, workspace } from '../../workspace/src/api'
import { redrawn } from './redraw.svelte'

const EVERY = 250
export const LONG = 500
const MOST = 6
const WITHIN = 60_000
export interface Stray {
  front: string | null
  marked: string | null
  shown: string[]
  lost: boolean
  strip: boolean
}
interface Wrong {
  key: string
  since: number
  redrawn: boolean
}
const wrong = new Map<string, Wrong>()
let told: number[] = []
const quoted = (id: string) => CSS.escape(id)
export function strayIn(paneId: string): Stray | null {
  const card = document.querySelector(`[data-pane="${quoted(paneId)}"] > .card`)
  if (!card) return null
  const front = workspace.panes.at(paneId)?.activeTabId ?? null
  const held = [...card.querySelectorAll<HTMLElement>(':scope > [data-kept]')]
  const shown = held.filter((one) => !one.hidden).map((one) => one.dataset.kept ?? '')
  const lost = held.some((one) => one.hidden && one.dataset.kept === front)
  const pick =
    front === null
      ? null
      : document.querySelector(`[data-strip="${quoted(paneId)}"] .pick[data-tab="${quoted(front)}"]`)
  const strip = !!pick && !pick.closest('.tab')?.classList.contains('active')
  if (!shown.some((id) => id !== front) && !lost && !strip) return null
  const marked =
    document.querySelector(`[data-strip="${quoted(paneId)}"] .tab.active .pick`)?.getAttribute('data-tab') ?? null
  return { front, marked, shown, lost, strip }
}
function named(id: string | null): { id: string | null; kind: string | null } {
  return { id, kind: workspace.tabs.find((one) => one.id === id)?.kind ?? null }
}
function say(paneId: string, found: Stray, did: string, now: number) {
  told = told.filter((at) => now - at < WITHIN)
  if (told.length >= MOST) return
  told.push(now)
  const pages = workspace
    .heldIn(paneId)
    .filter((one) => one.kind === 'web')
    .map((one) => [one.id, webPages().of(one.id).live, webPages().of(one.id).shown])
  const seen = {
    pane: paneId,
    front: named(found.front),
    strip: named(found.marked),
    shown: found.shown.map(named),
    frontHidden: found.lost,
    overview: tabOverview.open,
    pages,
  }
  log('warn', `pane shows another tab than the one in front, ${did}: ${JSON.stringify(seen)}`)
}
export function lookAtFronts(now: number): void {
  const here = new Set<string>()
  for (const pane of workspace.panes.all) {
    here.add(pane.id)
    const found = strayIn(pane.id)
    if (!found) {
      wrong.delete(pane.id)
      continue
    }
    const key = JSON.stringify(found)
    const was = wrong.get(pane.id)
    if (was?.key !== key) {
      wrong.set(pane.id, { key, since: now, redrawn: was?.redrawn ?? false })
      continue
    }
    if (now - was.since < LONG) continue
    was.since = now
    if (was.redrawn) {
      say(pane.id, found, 'still so after the pane was drawn again', now)
      continue
    }
    was.redrawn = true
    say(pane.id, found, 'so the pane is drawn again', now)
    redrawn.again(pane.id)
  }
  for (const id of wrong.keys()) if (!here.has(id)) wrong.delete(id)
}
let watching = false
export function watchFronts(): void {
  if (watching) return
  watching = true
  setInterval(() => {
    if (!document.hidden) lookAtFronts(performance.now())
  }, EVERY)
}
