import type { AgentAnswer } from '../../automation/caller'
import { account } from '../../accounts/src/api'
import { listed, type Listed, type Refused as Why } from '../../online/calls'
import { opens, rowOf } from '../../online/listing'
import { machine } from '../../online/machine.svelte'
import { isOnlineTab } from '../../online/path'
import { termOf } from '@orden/online/term'
import { relativeTo, samePath, within } from '../../platform/src/api'
import { runner } from '../../sync-client/src/api'
import type { Tab } from '../../workspace.svelte'
import { type Call, done } from './call'
import { Refused } from './problem'
import * as view from './reader-view'
import { reachable, tabsInReach } from './spaces'

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

export async function newOnline(call: Call): Promise<Tab | null> {
  const made = await view.openOnline(call)
  if (typeof made === 'string') throw refusedOf(made)
  return made
}

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
      machine: mine ? { id: mine.id, state: mine.state, held: mine.held } : null,
      ...(sessions === null
        ? { sessions_unknown: true }
        : { sessions: sessions.flatMap((one) => sessionOf(call, one)) }),
    },
    'tab titles and terminal output',
  )
}

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
