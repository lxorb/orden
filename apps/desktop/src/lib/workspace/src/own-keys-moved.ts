import { oneEdit } from '@orden/markdown/edits'
import type { MetaPatch } from '@orden/sync-core'
import { links } from '../../link-index/src/api'
import { invoke, log, isMarkdownPath, samePath, joinPath } from '../../platform/src/api'
import { ownKeys } from '../../web-backend/src/api'
import { type Change, changeOf } from '@orden/scan/search/replace'
import type { ItemMetaStore } from '../../space-kept/src/api'
import type { Keeping } from './note-text'

export interface Notes {
  readonly itemMeta: ItemMetaStore
  noteText(path: string): Promise<string | null>
  replaceInNotes(changes: readonly Change[], keeping?: Keeping): Promise<number>
}
const moving = new Map<string, Promise<void>>()
export function moveOwnKeysSoon(root: string, workspace: Notes, signedIn: boolean): Promise<void> {
  const running = moving.get(root)
  if (running) return running
  if (workspace.itemMeta.movedFromText(root)) return Promise.resolve()
  const moved = moveOwnKeys(root, workspace, signedIn)
    .catch((error: unknown) => log('warn', `own keys stayed in the notes: ${String(error)}`))
    .finally(() => moving.delete(root))
  moving.set(root, moved)
  return moved
}
function mayMove(root: string, workspace: Notes, signedIn: boolean): boolean {
  if (workspace.itemMeta.movedFromText(root)) return false
  return !signedIn || workspace.itemMeta.describes(root)
}
async function moveOwnKeys(root: string, workspace: Notes, signedIn: boolean): Promise<void> {
  await links.scanned()
  if (!samePath(links.rootOf(), root) || !mayMove(root, workspace, signedIn)) return
  const held = links.held()
  if (!held.length) return
  const patches: Record<string, MetaPatch> = {}
  const changes: Change[] = []
  const { ownKeysTaken } = await ownKeys()
  for (const note of held) {
    if (!isMarkdownPath(note.path) || !(note.icon || note.iconColor || note.cover)) continue
    const path = joinPath(root, note.path)
    const before = await workspace.noteText(path)
    const taken = before === null ? null : ownKeysTaken(before)
    if (before === null || !taken) continue
    const had = workspace.itemMeta.of(path, root) ?? {}
    const fresh = Object.fromEntries(Object.entries(taken.meta).filter(([key]) => !(key in had)))
    if (Object.keys(fresh).length) patches[note.path] = fresh
    const edit = oneEdit(before, taken.text)
    if (edit) changes.push(changeOf(path, before, [edit]))
  }
  if (!mayMove(root, workspace, signedIn)) return
  workspace.itemMeta.setMany(root, patches)
  if (changes.length)
    await keepingTimes(
      changes.map((one) => one.path),
      () => workspace.replaceInNotes(changes, { throughLocks: true }),
    )
  workspace.itemMeta.markMoved(root)
}
interface Stamp {
  modified: number
  created?: number
}
async function keepingTimes(paths: readonly string[], change: () => Promise<unknown>): Promise<void> {
  const stamps = new Map<string, Stamp>()
  for (const path of paths) {
    const stamp = await invoke<Stamp | null>('file_stamp', { path }).catch(() => null)
    if (stamp) stamps.set(path, stamp)
  }
  await change()
  for (const [path, { modified, created }] of stamps) {
    await invoke('set_file_times', { path, modified, ...(created ? { created } : {}) }).catch(() => undefined)
  }
}
