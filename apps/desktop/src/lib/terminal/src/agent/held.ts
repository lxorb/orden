import type { AgentAnswer } from '@orden/contracts'
import {
  type Call,
  done,
  maybe,
  openedBy,
  Refused,
  tabsInReach,
} from '../../../agent-verbs/src/api'
import { workspace } from '../../../workspace/src/api'
import { held, type HeldRow } from '../remote/held.svelte'
import { readSpec } from '../spec'

const SESSION = 'session:'

function inReach(call: Call): (row: HeldRow) => string | null | false {
  const agent = call.caller.agent
  const everywhere = agent === null || agent.spaces === 'all'
  const tabs = tabsInReach(call)
  return (row) => {
    const tab = tabs.find((one) => one.kind === 'terminal' && readSpec(one.doc)?.key === row.key)
    if (tab) return tab.id
    return everywhere && !row.open ? null : false
  }
}

export async function listHeld(call: Call): Promise<AgentAnswer> {
  await held.refresh()
  const reach = inReach(call)
  const sessions = held.list.flatMap((row) => {
    const tab = reach(row)
    if (tab === false) return []
    return [
      {
        session: row.key,
        name: row.name ?? row.program ?? 'Terminal',
        ...(row.host === null ? {} : { host: row.host }),
        ...(row.program === null ? {} : { program: row.program }),
        ...(row.folder === null ? {} : { cwd: row.folder }),
        running: !row.ended,
        ...(tab === null ? { detached: true, tab: `${SESSION}${row.key}` } : { tab }),
      },
    ]
  })
  return done({ sessions }, 'tab titles and terminal output')
}

export async function heldCall(call: Call): Promise<Call> {
  const named = maybe(call, 'tab')
  if (!named?.startsWith(SESSION)) return call
  const key = named.slice(SESSION.length)
  await held.refresh()
  const row = held.list.find((one) => one.key === key)
  const reached = row ? inReach(call)(row) : false
  if (!row || reached === false) {
    throw new Refused('no_such_tab', `there is no session ${key}: workspace_tabs list it`)
  }
  const tab = reached ?? held.open(row, false)
  openedBy(
    call,
    workspace.tabs.find((one) => one.id === tab),
    false,
  )
  return { ...call, args: { ...call.args, tab } }
}
