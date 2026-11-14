import { tick } from 'svelte'
import { focusEditor } from '../focus'
import { viewport } from '../ui-kit/src/api'
import { workspace } from '../workspace.svelte'
import { chromeGoes, chromeStays } from './chrome'
import { mayFill } from './rules'

let going = false

export async function toggleFill(tabId?: string): Promise<void> {
  if (workspace.panes.fills !== null) unfill()
  else await fill(tabId)
}

async function fill(tabId?: string): Promise<void> {
  if (going || workspace.panes.fills !== null) return
  if (tabId !== undefined && tabId !== workspace.activeTabId) workspace.activate(tabId)

  const pane = workspace.panes.focusedId
  if (!mayFill(workspace.panes.focused.activeTabId, viewport.touch)) return

  const held = document.activeElement
  const stranded = held instanceof HTMLElement && held.closest('[data-chrome]') !== null

  going = true
  try {
    await chromeGoes()
  } finally {
    going = false
  }

  if (
    workspace.panes.focusedId !== pane ||
    !mayFill(workspace.panes.focused.activeTabId, viewport.touch)
  ) {
    chromeStays()
    return
  }

  workspace.panes.fills = pane
  if (stranded) {
    await tick()
    focusEditor()
  }
}

export function unfill(): void {
  workspace.panes.fills = null
}
