/** What an agent does to the reader's window, in one place (#1070): in the background.
 *
 *  An agent at work never switches tabs, never jumps to what it works on and never moves
 *  the reader's focus, selection or scroll. A tab it opens or makes lands behind the one
 *  in front and wears the "opened by an agent" mark until the reader looks at it
 *  (`agentMarks.opened`); an edit lands in place, under the reader's caret where they are
 *  in the same note, through the one write path (agents/docs). The front, the keyboard
 *  and the scroll are the reader's.
 *
 *  Only a call that asks for the front - `background` false, `focus`, `split`, the graph,
 *  Settings, another space - brings anything forward, and only with `workspace.focus`:
 *  which the tool descriptions say is for when the reader asked, in their message, to be
 *  shown it.
 *
 *  Every verb that opens, makes, shows or moves to something on the reader's screen
 *  comes through here, and nothing else under agents/workspace calls the workspace's
 *  activating doors itself: test/agents-in-the-background.test.ts holds the folder to
 *  that, so a new tool cannot forget. */

import type { AgentAnswer } from '../../automation/caller'
import { agentMarks } from '../../agent-marks.svelte'
import { settings, type Section } from '../../settings.svelte'
import { type Tab, workspace } from '../../workspace.svelte'
import { type Call, done, flag, needScope } from './call'

/** Whether the call asked for the front, which needs `workspace.focus`; everything else
 *  is behind. `why` is what the refusal names. */
export function asksFront(call: Call, why: string): boolean {
  const front = 'background' in call.args && !flag(call, 'background')
  if (front) needScope(call, 'workspace.focus', why)
  return front
}

/** A tab an agent made or opened behind the reader, marked so until they look at it. */
function openedBy(call: Call, tab: Tab | null | undefined, front: boolean): Tab | null {
  if (!tab) return null
  const agent = call.caller.agent
  if (!front && agent) agentMarks.opened = { ...agentMarks.opened, [tab.id]: agent.name }
  return tab
}

/** A page in a tab of the reader's. */
export function openPage(call: Call, url: string): Tab | null {
  const front = asksFront(call, 'opening in front')
  const id = workspace.openPage(url, front ? 'plain' : 'behind')
  return openedBy(
    call,
    workspace.tabs.find((one) => one.id === id),
    front,
  )
}

/** A file of an open space in a tab: behind, beside the tab in front. */
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

/** A file of a space not on screen: the space comes forward with it, which is the reader's
 *  screen changing, so only ever asked for. */
export async function openInSpace(call: Call, space: string, path: string): Promise<Tab | null> {
  needScope(call, 'workspace.focus', 'another space')
  await workspace.showSpace(space)
  return openFile(call, path, true)
}

/** An unsaved note, canvas or page note in a new tab. */
export function openUnsaved(call: Call, kind: 'note' | 'canvas' | 'pages', words: string): Tab {
  const front = asksFront(call, 'a new tab in front')
  const beside = front ? null : workspace.activeTabId
  const made = workspace.openUnsaved(kind, words, undefined, beside, front)
  openedBy(call, made, front)
  return made
}

/** A terminal in a new tab. Only made: its shell starts when it is first shown or typed
 *  into. */
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

/** A chat's own tab, opened behind for a draft the reader sends. */
export async function openChat(path: string): Promise<void> {
  const { openChat: open } = await import('../../chats/view/open')
  open(path, { activate: false })
}

/** The scratchpad's card: up, and with the keyboard only where the front was asked for. */
export async function showScratchpad(call: Call): Promise<AgentAnswer> {
  const front = asksFront(call, 'opening in front')
  const { scratchpad } = await import('../../scratchpad/pad')
  scratchpad.show(null, front)
  return done({ scratchpad: true })
}

/** The graph, which only ever opens in front of its pane. */
export function showGraph(call: Call): Tab | null {
  needScope(call, 'workspace.focus', 'the graph')
  workspace.openGraph()
  return workspace.active
}

/** Settings at a section: a sheet over the window, so only ever in front. */
export function showSettings(call: Call, section: Section): void {
  needScope(call, 'workspace.focus', 'Settings')
  settings.show(section)
}

/** A tab brought to the front: the reader asked for it. */
export function showTab(call: Call, tab: Tab): void {
  needScope(call, 'workspace.focus', 'bringing a tab to the front')
  workspace.activate(tab.id)
}

/** A pane made beside the tab's: the reader's screen changes, so only ever asked for. */
export function splitBeside(call: Call, tab: Tab): void {
  needScope(call, 'workspace.focus', 'a split')
  workspace.split('row', tab.id)
}
