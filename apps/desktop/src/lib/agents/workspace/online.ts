/** The reader's online machine, to an agent: `workspace_tabs` `list` and `new` of `kind`
 *  `online` (docs/agent-native.md 8.9, online-terminal.md 4.10).
 *
 *  `list` is Settings › Online terminal read: whether the account may have a machine, the
 *  machine's state, and its sessions with the tab or the file that opens each. `new` is
 *  Ctrl+T's Online terminal pressed for the reader: a new session on their own machine,
 *  made and woken if need be, in a tab behind the one in front. A terminal on somebody
 *  else's machine is their `.term` in a space, which `open` opens. What the account
 *  refuses, the agent is told with its reason, and nobody is shown a sheet. */

import type { AgentAnswer } from '../../automation/caller'
import { account } from '../../account.svelte'
import { listed, type Listed, type Refused as Why } from '../../online/calls'
import { opens, rowOf } from '../../online/listing'
import { machine } from '../../online/machine.svelte'
import { isOnlineTab } from '../../online/path'
import { termOf } from '@orden/online/term'
import { relativeTo, samePath, within } from '../../space-paths'
import { runner } from '../../sync2/runner.svelte'
import type { Tab } from '../../workspace.svelte'
import { type Call, done } from './call'
import { Refused } from './problem'
import * as view from './reader-view'
import { reachable, tabsInReach } from './spaces'

/** What each refusal is to an agent: the reader's to grant, or the machine's to lift. */
const WHY: Record<Why, [Refused['code'], string]> = {
  'signed-out': ['not_granted', 'the reader is signed out; an online terminal is their account’s'],
  list: ['not_granted', 'online terminals are not open to the reader’s account yet'],
  allowance: ['failed', 'this month’s online hours are used'],
  budget: ['failed', 'online terminals are paused for now'],
  off: ['failed', 'online terminals are paused for now'],
  flag: ['failed', 'the machine is stopped'],
  sessions: ['failed', 'the machine has eight terminals already; the reader ends one in Settings'],
  other: ['failed', 'the machine could not be reached'],
}

function refusedOf(why: Why): Refused {
  const [code, words] = WHY[why]
  return new Refused(code, `${why}: ${words}`)
}

/** `new`: a session of the reader's own, in a tab of its own; the answer's id is the tab
 *  `read_terminal`, `type_terminal` and `run_terminal` take. */
export async function newOnline(call: Call): Promise<Tab | null> {
  const made = await view.openOnline(call)
  if (typeof made === 'string') throw refusedOf(made)
  return made
}

/** `list`: the machine and its sessions. */
export async function listOnline(call: Call): Promise<AgentAnswer> {
  if (!account.accountToken) throw refusedOf('signed-out')
  await machine.refresh()
  if (machine.refused) throw refusedOf(machine.refused)

  const known = machine.known
  const mine = known?.machine ?? null
  const sessions = known?.allowed && mine ? await listed().catch(() => null) : []
  return done(
    {
      allowed: known?.allowed === true,
      // None yet: the first `new` makes it.
      machine: mine ? { id: mine.id, state: mine.state, held: mine.held } : null,
      ...(sessions === null
        ? { sessions_unknown: true }
        : { sessions: sessions.flatMap((one) => sessionOf(call, one)) }),
    },
    'tab titles and terminal output',
  )
}

/** A session as the agent may know it: the tab open on it, or the file that opens it in a
 *  space it reaches. One whose file is in a space beyond its grant does not exist to it. */
function sessionOf(call: Call, one: Listed) {
  const file = one.term !== null && opens(one) ? runner.fileOf(one.term) : null
  const space = file === null ? null : reachable(call).find((it) => within(it.root, file) !== null)
  if (file !== null && !space) return []

  const tab = tabsInReach(call).find(
    (it) =>
      isOnlineTab(it) &&
      ((file !== null && it.path !== null && samePath(it.path, file)) ||
        termOf(it.doc)?.session === one.session),
  )
  return [
    {
      session: one.session,
      name: rowOf(one).name ?? 'Terminal',
      ...(one.alive === null ? {} : { alive: one.alive }),
      ...(tab ? { tab: tab.id } : {}),
      ...(space && file ? { space: space.id, path: relativeTo(space.root, file) } : {}),
    },
  ]
}
