import type { Caller } from '../../automation/src/api'
import { insideOnly, namesByShortName } from '../../platform/src/api'
import { type Space, workspace } from '../../workspace/src/api'
import { Refused } from './refused'

export interface Place {
  space: Space
  open: boolean
}
export interface Reaching {
  readonly caller: Caller
}
export function reaches(call: Reaching, space: Space): boolean {
  const agent = call.caller.agent
  return agent === null || agent.spaces === 'all' || agent.spaces.includes(space.name)
}
export function reachable(call: Reaching): Space[] {
  return workspace.spaces.filter((space) => reaches(call, space))
}
export function placeFor(call: Reaching, named: string | null): Place {
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
export function judged(asked: string): string {
  const safe = insideOnly(asked)
  if (safe === null) throw new Refused('bad_arguments', `${asked} is not a path inside the space`)
  if (safe.includes(':')) {
    throw new Refused('bad_arguments', `${asked} holds a colon, which names a stream on Windows`)
  }
  if (namesByShortName(safe)) {
    throw new Refused('bad_arguments', `${asked} is a short name: give each name in full`)
  }
  return safe
}
export function judgedForWriting(asked: string): string {
  const safe = judged(asked)
  if (safe.split('/').some((step) => step.startsWith('.'))) {
    throw new Refused('bad_arguments', `${asked} is hidden, and an agent leaves it alone`)
  }
  return safe
}
