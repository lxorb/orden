import { threadSpaceOf } from '../automation/caller'
import { insideOnly, insideSpace, nameOf, relativeTo, within } from '../platform/src/api'
import { canWriteAt, reachedAs, reachedByOthersIn } from '../sharing/src/api'
import { type Space, type Tab, workspace } from '../workspace.svelte'
import { type Call, maybe } from './call'
import { Refused } from './problem'

export interface Place {
  space: Space
  open: boolean
}

function reaches(call: Call, space: Space): boolean {
  const agent = call.caller.agent
  return agent === null || agent.spaces === 'all' || agent.spaces.includes(space.name)
}

export function reachable(call: Call): Space[] {
  return workspace.spaces.filter((space) => reaches(call, space))
}

export function tabsInReach(call: Call): Tab[] {
  const agent = call.caller.agent
  if (agent === null || agent.spaces === 'all') return workspace.tabs

  const reached = new Set(reachable(call).map((one) => one.id))
  return workspace.tabs.filter((tab) => reached.has(workspace.spaceOf(tab.note) ?? ''))
}

export function placeFor(call: Call, named: string | null): Place {
  const open = workspace.activeSpace

  if (named === null) {
    if (!open) throw new Refused('no_such_space', 'there is no space open: say which space')
    if (!reaches(call, open)) {
      throw new Refused('no_such_space', 'say which space: list_spaces names the ones you reach')
    }
    return { space: open, open: true }
  }

  const folded = named.trim().toLowerCase()
  const found = reachable(call).find((one) => one.id === named || one.name.toLowerCase() === folded)
  if (!found) throw new Refused('no_such_space', `there is no space called ${named}`)

  return { space: found, open: found.id === open?.id }
}

export function placeOf(call: Call): Place {
  const named = maybe(call, 'space')
  if (named !== null) return placeFor(call, named)

  const id = threadSpaceOf(call.caller)
  if (!id) return placeFor(call, null)
  const home = workspace.spaces.find((one) => one.id === id)
  if (!home)
    throw new Refused('no_such_space', 'the space this thread works in is gone: say which space')
  if (!reaches(call, home)) {
    throw new Refused('no_such_space', 'say which space: list_spaces names the ones you reach')
  }
  return { space: home, open: home.id === workspace.activeSpace?.id }
}

export function judged(asked: string): string {
  const safe = insideOnly(asked)
  if (safe === null) throw new Refused('bad_arguments', `${asked} is not a path inside the space`)

  return safe
}

export function judgedForWriting(asked: string): string {
  const safe = judged(asked)
  if (safe.split('/').some((step) => step.startsWith('.'))) {
    throw new Refused('bad_arguments', `${asked} is hidden, and an agent leaves it alone`)
  }

  return safe
}

export function sharedSource(place: Place, relative = ''): string | null {
  if (relative) return docSource({ path: onDisk(place, relative), shared: null })
  return reachedByOthersIn(place.space.root) ? `shared space ${place.space.name}` : null
}

export function docSource(doc: { path: string | null; shared: string | null }): string | null {
  if (doc.shared !== null) return 'note shared with you'
  const path = doc.path
  const how = reachedAs(path)
  if (path === null || how === null) return null

  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (how === 'space' && space) return `shared space ${space.name}`
  return `shared note ${space ? relativeTo(space.root, path) : nameOf(path)}`
}

export function onDisk(place: Place, relative: string): string {
  return insideSpace(place.space.root, relative)
}

export function writableAt(place: Place, path: string): void {
  if (!canWriteAt(path)) {
    throw new Refused('read_only', `${place.space.name} is shared with you to read`)
  }
}
