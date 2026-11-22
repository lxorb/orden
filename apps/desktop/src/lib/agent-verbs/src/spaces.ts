import { threadSpaceOf } from '../../automation/src/api'
import { insideSpace, nameOf, relativeTo, spaceHolding } from '../../platform/src/api'
import { canWriteAt, reachedAs, reachedByOthersIn } from '../../sharing/src/api'
import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { type Call, maybe } from './call'
import { type Place, placeFor, reachable, reaches, Refused } from '../../reader-verbs/src/api'

export function reachesSpace(call: Call, id: string | null): boolean {
  const agent = call.caller.agent
  if (agent === null || agent.spaces === 'all') return true
  return id !== null && reachable(call).some((one) => one.id === id)
}
export function tabsInReach(call: Call): Tab[] {
  const agent = call.caller.agent
  if (agent === null || agent.spaces === 'all') return workspace.tabs
  const reached = new Set(reachable(call).map((one) => one.id))
  return workspace.tabs.filter((tab) => reached.has(workspace.spaceOf(tab.note) ?? ''))
}
export function placeOf(call: Call): Place {
  const named = maybe(call, 'space')
  if (named !== null) return placeFor(call, named)
  const id = threadSpaceOf(call.caller)
  if (!id) return placeFor(call, null)
  const home = workspace.spaces.find((one) => one.id === id)
  if (!home) throw new Refused('no_such_space', 'the space this thread works in is gone: say which space')
  if (!reaches(call, home)) {
    throw new Refused('no_such_space', 'say which space: list_spaces names the ones you reach')
  }
  return { space: home, open: home.id === workspace.activeSpace?.id }
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
  const space = spaceHolding(workspace.spaces, path)
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
export { judged, judgedForWriting, type Place, placeFor, reachable } from '../../reader-verbs/src/api'
