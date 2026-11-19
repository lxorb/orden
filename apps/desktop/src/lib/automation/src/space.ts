import { canWriteAt } from '../../sharing/src/api'
import { protection } from '../../protect/src/api'
import { insideSpace, withinSpace, insideOnly, namesByShortName } from '../../platform/src/api'
import { type Space, workspace } from '../../workspace/src/api'
import { said, type Said } from './args'

export interface Note {
  relative: string
  path: string
  text: string
}
export async function spaceFor(args: Said): Promise<Space> {
  const wanted = said(args, 'space')
  if (!wanted) {
    const open = workspace.activeSpace
    if (!open) throw new Error('there is no space open')
    return open
  }
  const folded = wanted.toLowerCase()
  const found = workspace.spaces.find((one) => one.id === wanted || one.name.toLowerCase() === folded)
  if (!found) throw new Error(`there is no space called ${wanted}`)
  if (found.id !== workspace.activeSpaceId) await workspace.showSpace(found.id)
  return found
}
export async function spaceToWrite(args: Said): Promise<Space> {
  const space = await spaceFor(args)
  if (!canWriteAt(space.root)) throw new Error(`${space.name} is shared with you to read`)
  return space
}
export function relativeIn(args: Said, name = 'path'): string {
  const asked = said(args, name)
  if (!asked) throw new Error(`say which ${name}`)
  return insidePath(asked)
}
export function insidePath(asked: string): string {
  const safe = insideOnly(asked)
  if (safe === null) throw new Error(`${asked} is not a path inside the space`)
  if (namesByShortName(safe)) throw new Error(`${asked} is a short name: give each name in full`)
  return safe
}
export function agentsMayAll(path: string, relative: string): void {
  if (!protection.agentsMayAll(path)) throw new Error(`${relative} is protected`)
}
export async function noteFor(args: Said, name = 'path', writing = false): Promise<Note> {
  const space = await (writing ? spaceToWrite : spaceFor)(args)
  if (said(args, name) === null) {
    const open = workspace.active
    const path = open?.path
    if (!open || !path) throw new Error('no note is open, so say which path')
    const relative = withinSpace(space.root, path)
    if (relative === null) throw new Error('no note of this space is open, so say which path')
    agentsMayAll(path, relative)
    workspace.flush()
    return { relative, path, text: open.doc }
  }
  const relative = relativeIn(args, name)
  const path = insideSpace(space.root, relative)
  agentsMayAll(path, relative)
  const text = await workspace.noteText(path)
  if (text === null) throw new Error(`there is no note at ${relative}`)
  return { relative, path, text }
}
