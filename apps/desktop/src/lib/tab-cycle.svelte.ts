import { keep, storedText } from './platform/src/api'
import { workspace } from './workspace.svelte'
import type { Tab } from './workspace/documents.svelte'
import { Walk } from './workspace/recency'

const KEY = 'orden:tab-order'

class TabCycle {
  byUse = $state(storedText(KEY) === 'use')

  setByUse(on: boolean) {
    this.byUse = on
    keep(KEY, on ? 'use' : 'strip')
  }
}

export const tabCycle = new TabCycle()

let walk: Walk | null = null

let holding = false

function heard(event: KeyboardEvent) {
  holding = event.ctrlKey || event.metaKey || event.altKey
  if (walk && !holding) finish()
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', heard, true)
  window.addEventListener('keyup', heard, true)
}

export function cycleTab(direction: number, mayUseOrder = false) {
  const tabs = workspace.tabsIn(workspace.panes.focusedId)
  const current = workspace.activeTabId
  if (!current) {
    backToTabs(tabs, direction)
    return
  }

  const index = tabs.findIndex((tab) => tab.id === current)
  if (index < 0) return

  if (!mayUseOrder || !tabCycle.byUse) {
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    if (next) workspace.activate(next.id)
    return
  }

  if (!walk) {
    walk = new Walk(
      tabs.map((tab) => tab.id),
      current,
      workspace.panes.used,
    )
    window.addEventListener('blur', finish)
    window.addEventListener('pointerdown', finish, true)
  }

  const next = walk.step(direction)
  if (next) workspace.activate(next)
  if (!holding) finish()
}

function backToTabs(tabs: readonly Tab[], direction: number) {
  const last = workspace.panes.lastOf(tabs.map((tab) => tab.id))
  const back = last ?? (direction > 0 ? tabs[0] : tabs.at(-1))?.id
  if (back) workspace.activate(back)
}

function finish() {
  window.removeEventListener('blur', finish)
  window.removeEventListener('pointerdown', finish, true)
  if (walk) workspace.panes.used = walk.ended(workspace.activeTabId)
  walk = null
}
