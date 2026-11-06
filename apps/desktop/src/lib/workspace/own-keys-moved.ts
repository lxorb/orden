import { oneEdit } from '@orden/markdown/edits'
import type { MetaPatch } from '@orden/sync-core/meta'
import { links } from '../link-index.svelte'
import { log } from '../log'
import { ownKeysTaken } from '../own-keys'
import type { Change } from '../search/apply'
import { changeOf } from '../search/replace'
import { isMarkdownPath, samePath } from '../space-paths'
import { joinPath } from '../tauri'
import type { ItemMetaStore } from './item-meta.svelte'

export interface Notes {
  readonly itemMeta: ItemMetaStore
  noteText(path: string): Promise<string | null>
  replaceInNotes(changes: readonly Change[]): Promise<number>
}

const moving = new Set<string>()

export function moveOwnKeysSoon(root: string, workspace: Notes, signedIn: boolean): void {
  if (moving.has(root) || workspace.itemMeta.movedFromText(root)) return
  moving.add(root)
  void moveOwnKeys(root, workspace, signedIn)
    .catch((error: unknown) => log('warn', `own keys stayed in the notes: ${String(error)}`))
    .finally(() => moving.delete(root))
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
  if (changes.length) await workspace.replaceInNotes(changes)
  workspace.itemMeta.markMoved(root)
}
