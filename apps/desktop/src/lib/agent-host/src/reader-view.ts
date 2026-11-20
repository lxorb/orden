import { type AgentAnswer, type SettingsSectionId, settingsWindow } from '@orden/contracts'
import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { panesIn, paneToward, type Toward } from '../../panes/src/api'
import { type Call, done, openedBy, Refused } from '../../agent-verbs/src/api'

export function readersView(call: Call, what: string): void {
  if (call.caller.agent !== null) {
    throw new Refused('by_hand', `${what} changes what the reader sees, so it is the reader's to do`)
  }
}
export function openPage(call: Call, url: string): Tab | null {
  const id = workspace.openPage(url, 'behind')
  return openedBy(
    call,
    workspace.tabs.find((one) => one.id === id),
    false,
  )
}
export async function openFile(call: Call, path: string): Promise<Tab | null> {
  await workspace.openEntry(path, { activate: false, beside: true })
  return openedBy(
    call,
    workspace.tabs.find((one) => one.path === path),
    false,
  )
}
export async function openInSpace(call: Call, space: string, path: string, link: string): Promise<Tab | null> {
  readersView(call, `opening a note in another space (the reader can follow ${link})`)
  await workspace.showSpace(space)
  await workspace.openEntry(path)
  return workspace.active
}
export function openUnsaved(call: Call, kind: 'note' | 'canvas' | 'pages', words: string): Tab {
  const made = workspace.openUnsaved(kind, words, undefined, workspace.activeTabId, false)
  openedBy(call, made, false)
  return made
}
export async function showScratchpad(call: Call): Promise<AgentAnswer> {
  readersView(call, 'showing the scratchpad (write to it with write_note, tab scratchpad)')
  const scratchpad = await import('../../scratchpad/src/api').then((one) => one.pad())
  scratchpad.show(null, false)
  return done({ scratchpad: true })
}
export function showGraph(call: Call): Tab | null {
  readersView(call, 'the graph')
  workspace.openGraph()
  return workspace.active
}
export function showSettings(call: Call, section: SettingsSectionId): void {
  readersView(call, 'Settings')
  settingsWindow().show(section)
}
export function showTab(call: Call, tab: Tab): void {
  readersView(call, 'bringing a tab to the front')
  workspace.activate(tab.id)
}
export function splitBeside(call: Call, tab: Tab): void {
  readersView(call, 'a split')
  workspace.split('row', tab.id)
}
export function paneFor(tab: Tab, pane: string | null, toward: string | null): string | null {
  if (pane !== null) return workspace.panes.at(pane) ? pane : null
  if (toward === null || !['left', 'right', 'up', 'down'].includes(toward)) return null
  return paneToward(workspace.panes.frame, tab.paneId, toward as Toward)?.id ?? null
}
export function moveTabTo(call: Call, tab: Tab, pane: string, at: number | null): void {
  readersView(call, 'moving a tab')
  workspace.moveTab(tab.id, pane, at)
}
export function arrangePanes(call: Call, layout: string, tab: Tab | null): void {
  readersView(call, 'arranging the panes')
  const panes = panesIn(workspace.panes.frame)
  switch (layout) {
    case 'columns':
    case 'rows':
      workspace.split(layout === 'columns' ? 'row' : 'column', tab?.id)
      return
    case 'even':
      for (const one of panes) workspace.panes.equalise(one.id)
      return
    case 'single': {
      const into = workspace.panes.focusedId
      for (const one of [...workspace.tabs]) {
        const shown = workspace.panes.at(one.paneId) !== null
        if (shown && one.paneId !== into) workspace.moveTab(one.id, into)
      }
      return
    }
    default:
      throw new Refused('bad_arguments', 'layout is columns, rows, even or single')
  }
}
