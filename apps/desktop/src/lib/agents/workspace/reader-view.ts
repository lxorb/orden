import type { AgentAnswer } from '../../automation/caller'
import { agentMarks } from '../../agent-marks.svelte'
import type { Refused as Why } from '../../online/calls'
import { settings, type Section } from '../../settings.svelte'
import { type Tab, workspace } from '../../workspace.svelte'
import { panesIn, paneToward, type Toward } from '../../workspace/pane-tree'
import { type Call, done, flag, needScope } from './call'
import { Refused } from './problem'

export function asksFront(call: Call, why: string): boolean {
  const front = 'background' in call.args && !flag(call, 'background')
  if (front) needScope(call, 'workspace.focus', why)
  return front
}

function openedBy(call: Call, tab: Tab | null | undefined, front: boolean): Tab | null {
  if (!tab) return null
  const agent = call.caller.agent
  if (!front && agent) agentMarks.opened = { ...agentMarks.opened, [tab.id]: agent.name }
  return tab
}

export function openPage(call: Call, url: string): Tab | null {
  const front = asksFront(call, 'opening in front')
  const id = workspace.openPage(url, front ? 'plain' : 'behind')
  return openedBy(
    call,
    workspace.tabs.find((one) => one.id === id),
    front,
  )
}

export async function openFile(
  call: Call,
  path: string,
  front = asksFront(call, 'opening in front'),
): Promise<Tab | null> {
  await workspace.openEntry(path, front ? {} : { activate: false, beside: true })
  return openedBy(
    call,
    workspace.tabs.find((one) => one.path === path),
    front,
  )
}

export async function openInSpace(call: Call, space: string, path: string): Promise<Tab | null> {
  needScope(call, 'workspace.focus', 'another space')
  await workspace.showSpace(space)
  return openFile(call, path, true)
}

export function openUnsaved(call: Call, kind: 'note' | 'canvas' | 'pages', words: string): Tab {
  const front = asksFront(call, 'a new tab in front')
  const beside = front ? null : workspace.activeTabId
  const made = workspace.openUnsaved(kind, words, undefined, beside, front)
  openedBy(call, made, front)
  return made
}

export async function openTerminal(
  call: Call,
  shell: string,
  folder?: string,
): Promise<Tab | null> {
  const front = asksFront(call, 'a new tab in front')
  const beside = front ? null : workspace.activeTabId
  const { openTerminal: made } = await import('../../terminal/open')
  const tab = await made(shell, {
    ...(folder === undefined ? {} : { folder }),
    ...(beside ? { beside } : {}),
    activate: front,
  })
  return openedBy(call, tab, front)
}

export async function openOnline(call: Call): Promise<Tab | Why | null> {
  const front = asksFront(call, 'a new tab in front')
  const { madeOnline } = await import('../../online/open')
  const made = await madeOnline(front ? null : workspace.activeTabId, front)
  return typeof made === 'string' ? made : openedBy(call, made, front)
}

export async function openChat(path: string): Promise<void> {
  const { openChat: open } = await import('../../chats/view/open')
  open(path, { activate: false })
}

export async function showScratchpad(call: Call): Promise<AgentAnswer> {
  const front = asksFront(call, 'opening in front')
  const { scratchpad } = await import('../../scratchpad/pad')
  scratchpad.show(null, front)
  return done({ scratchpad: true })
}

export function showGraph(call: Call): Tab | null {
  needScope(call, 'workspace.focus', 'the graph')
  workspace.openGraph()
  return workspace.active
}

export function showSettings(call: Call, section: Section): void {
  needScope(call, 'workspace.focus', 'Settings')
  settings.show(section)
}

export function showTab(call: Call, tab: Tab): void {
  needScope(call, 'workspace.focus', 'bringing a tab to the front')
  workspace.activate(tab.id)
}

export function splitBeside(call: Call, tab: Tab): void {
  needScope(call, 'workspace.focus', 'a split')
  workspace.split('row', tab.id)
}

export function paneFor(tab: Tab, pane: string | null, toward: string | null): string | null {
  if (pane !== null) return workspace.panes.at(pane) ? pane : null
  if (toward === null || !['left', 'right', 'up', 'down'].includes(toward)) return null
  return paneToward(workspace.panes.frame, tab.paneId, toward as Toward)?.id ?? null
}

export function moveTabTo(call: Call, tab: Tab, pane: string, at: number | null): void {
  needScope(call, 'workspace.focus', 'moving a tab')
  workspace.moveTab(tab.id, pane, at)
}

export function arrangePanes(call: Call, layout: string, tab: Tab | null): void {
  needScope(call, 'workspace.focus', 'arranging the panes')
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
        if (one.paneId !== into) workspace.moveTab(one.id, into)
      }
      return
    }
    default:
      throw new Refused('bad_arguments', 'layout is columns, rows, even or single')
  }
}
