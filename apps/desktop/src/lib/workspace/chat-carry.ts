import { isChatTarget } from '@orden/markdown/links'
import { account } from '../accounts/src/api'
import { roleOf } from '../sharing/src/api'
import { samePath, within, invoke } from '../platform/src/api'
import { sync } from '../sync.svelte'
import { type Entry, workspace } from '../workspace.svelte'

function pointersUnder(entry: Entry, found: string[] = []): string[] {
  if (!entry.is_dir) {
    if (isChatTarget(entry.path)) found.push(entry.path)
    return found
  }
  for (const child of entry.children) pointersUnder(child, found)
  return found
}

function pointersIn(path: string): string[] {
  const entry = workspace.entryAt(path)
  if (entry) return pointersUnder(entry)
  return isChatTarget(path) ? [path] : []
}

export async function pointersMoving(path: string): Promise<string[]> {
  const entry = workspace.entryAt(path)
  if (entry) return pointersUnder(entry)
  if (isChatTarget(path)) return [path]
  const listed = await invoke<Entry>('read_tree', { root: path }).catch(() => null)
  return listed ? pointersUnder(listed) : []
}

export function spaceHolding(path: string) {
  return workspace.spaces.find((one) => within(one.root, path) !== null) ?? null
}

function ownerOf(root: string): string | null {
  const id = sync.remoteIdFor(root)
  const remote = id ? account.spaces.find((one) => one.id === id) : undefined
  if (!remote || remote.role === 'owner') return account.user?.id ?? null
  return remote.people?.[0] ?? null
}

export function mayCarry(path: string, root: string, pointers = pointersIn(path)): boolean {
  const from = spaceHolding(path)
  if (!from || samePath(from.root, root) || !pointers.length) return true
  if (roleOf(from.root) === 'owner') return true
  const owner = ownerOf(from.root)
  return owner !== null && owner === ownerOf(root)
}
