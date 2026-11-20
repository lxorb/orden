import type { AgentCaller, AgentSaid, AgentTabKind } from '@orden/contracts'
import { type Call, judged, maybe, onDisk, openedBy, placeFor, Refused, verbsOf } from '../../../agent-verbs/src/api'
import { workspace } from '../../../workspace/src/api'
import { openTerminal } from '../open'
import { shellRunning } from '../running'
import { shells } from '../shells.svelte'
import { heldCall, listHeld } from './held'
import { listOnline, newOnline } from './online'
import { runTerminal } from './run'
import { readTerminal, terminalSelection, typeTerminal } from './tab'

export const terminalVerbs = verbsOf({
  run_terminal: runTerminal,
  read_terminal: async (call) => readTerminal(await heldCall(call)),
  type_terminal: async (call) => typeTerminal(await heldCall(call)),
})
function callOf(args: AgentSaid, caller: AgentCaller): Call {
  return { verb: 'workspace_tabs', args, caller }
}
async function newTerminal(call: Call): Promise<string | null> {
  const list = await shells.ask()
  const named = maybe(call, 'shell')?.toLowerCase() ?? null
  const shell =
    named === null ? shells.chosen : list.find((one) => [one.id, one.name].some((word) => word.toLowerCase() === named))
  if (!shell) {
    const names = list.map((one) => one.name).join(', ')
    throw new Refused('bad_arguments', `there is no shell ${named ?? ''}: ${names}`)
  }
  const cwd = maybe(call, 'cwd')
  const folder = cwd === null ? undefined : onDisk(placeFor(call, null), judged(cwd))
  const beside = workspace.activeTabId
  const tab = await openTerminal(shell.id, {
    ...(folder === undefined ? {} : { folder }),
    ...(beside ? { beside } : {}),
    activate: false,
  })
  return openedBy(call, tab, false)?.id ?? null
}
export const terminalTabs: AgentTabKind = {
  open: (args, caller) => newTerminal(callOf(args, caller)),
  list: (args, caller) => listHeld(callOf(args, caller)),
  running: (tab) => shellRunning(tab),
  selection: async (id, most) => {
    const tab = workspace.tabs.find((one) => one.id === id)
    return tab ? terminalSelection(tab, most) : null
  },
}
export const onlineTabs: AgentTabKind = {
  open: (args, caller) => newOnline(callOf(args, caller)),
  list: (args, caller) => listOnline(callOf(args, caller)),
}
