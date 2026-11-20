import { type TabKind, webPages } from '@orden/contracts'
import { tick } from 'svelte'
import { viewport } from '../../ui-kit/src/api'
import { agentMarks, type Tab, workspace } from '../../workspace/src/api'
import { autoTidy } from './choice.svelte'
import { seen } from './seen'

const HOUR = 3_600_000
const KEPT: ReadonlySet<TabKind> = new Set<TabKind>(['terminal', 'application', 'chat'])
const pathsOf = (tabs: readonly Tab[]): string[] => tabs.flatMap((tab) => (tab.path === null ? [] : [tab.path]))
function inColumns(tab: Tab): boolean {
  const pane = workspace.panes.at(tab.paneId)
  return !!pane?.stacked && !viewport.touch && tab.kind === 'note' && !tab.reading
}
export function shownTabs(): Tab[] {
  const fronts = workspace.panes.all.map((pane) => pane.activeTabId)
  return workspace.tabs.filter((tab) => fronts.includes(tab.id) || inColumns(tab))
}
export function tidyable(tab: Tab): boolean {
  if (tab.path === null || tab.essential !== null || tab.dirty || tab.running !== null) return false
  if (KEPT.has(tab.kind) || tab.inPrivate || tab.coming || tab.naming || tab.id in agentMarks.on) return false
  if (shownTabs().includes(tab)) return false
  return !(tab.kind === 'web' && (webPages().of(tab.id).playing || webPages().lentOf(tab.id)))
}
const seenAt = (tab: Tab, now: number): number => (tab.path === null ? now : (seen.of(tab.path) ?? now))
const byAge = (tabs: readonly Tab[], now: number): Tab[] =>
  [...tabs].sort((one, other) => seenAt(one, now) - seenAt(other, now))
export function sweep(now = Date.now()): Tab[] {
  if (!autoTidy.on || !workspace.restored) return []
  const shown = shownTabs()
  seen.stamp(pathsOf(shown), now)
  seen.stamp(
    pathsOf(workspace.tabs).filter((path) => seen.of(path) === undefined),
    now,
  )
  const after = autoTidy.hours * HOUR
  const going = workspace.panes.all.flatMap((pane) => {
    const strip = workspace.tabsIn(pane.id)
    const old = strip.filter((tab) => !shown.includes(tab) && now - seenAt(tab, now) >= after && tidyable(tab))
    if (old.length < strip.length || workspace.showing(pane.id)) return old
    return byAge(old, now).slice(0, -1)
  })
  if (!going.length) return []
  const ordered = byAge(going, now)
  workspace.closeEach(
    ordered.map((tab) => tab.id),
    true,
  )
  const left = pathsOf(workspace.tabs)
  seen.forget(pathsOf(ordered).filter((path) => !left.includes(path)))
  return ordered
}
function watch(now: () => number): () => void {
  let known: Set<string> | null = null
  let front: string[] = []
  return $effect.root(() => {
    $effect(() => {
      if (!autoTidy.on || !workspace.restored) return
      const space = workspace.activeSpaceId
      void tick().then(() => {
        if (workspace.activeSpaceId === space) sweep(now())
      })
    })
    $effect(() => {
      if (!autoTidy.on || !workspace.restored) {
        known = null
        front = []
        return
      }
      const paths = new Set(pathsOf(workspace.tabs))
      const shown = pathsOf(shownTabs())
      const at = now()
      seen.stamp(
        [...paths].filter((path) => seen.of(path) === undefined),
        at,
      )
      seen.stamp(
        [...front, ...shown].filter((path) => paths.has(path)),
        at,
      )
      const before = known
      if (before) seen.forget([...before].filter((path) => !paths.has(path)))
      known = paths
      front = shown
    })
  })
}
export interface Tidying {
  readonly now?: () => number
  readonly every?: number
}
export function startAutoTidy({ now = Date.now, every = 60_000 }: Tidying = {}): () => void {
  seen.read()
  const stopWatching = watch(now)
  const tidy = () => void sweep(now())
  const back = () => {
    if (document.visibilityState === 'visible') tidy()
  }
  const timer = setInterval(tidy, every)
  window.addEventListener('focus', tidy)
  document.addEventListener('visibilitychange', back)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', tidy)
    document.removeEventListener('visibilitychange', back)
    stopWatching()
  }
}
