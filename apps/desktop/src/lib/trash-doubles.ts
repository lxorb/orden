import { sync } from './sync.svelte'
import { invoke } from './platform/src/api'
import type { TrashItem } from './trash.svelte'
import { workspace } from './workspace.svelte'

export interface AccountNote {
  spaceId: string
  path: string
  deletedAt: number
}

export function folderOfSpace(spaceId: string): string | null {
  const space = workspace.spaces.find((one) => sync.remoteIdFor(one.root) === spaceId)
  return space ? (space.root.split(/[\\/]/).pop() ?? null) : null
}

export function doublesOf(
  device: readonly TrashItem[],
  account: readonly AccountNote[],
  folderOf: (spaceId: string) => string | null,
): string[] {
  const gone = new Map<string, number>()
  for (const note of account) {
    const folder = folderOf(note.spaceId)
    if (folder === null) continue
    const key = `${folder}/${note.path}`.toLowerCase()
    gone.set(key, Math.min(gone.get(key) ?? Infinity, note.deletedAt))
  }
  return device
    .filter((item) => {
      if (item.kind !== 'note') return false
      const at = item.from === undefined ? undefined : gone.get(item.from.toLowerCase())
      return at !== undefined && item.deletedAt >= at
    })
    .map((item) => item.id)
}

export async function withoutDoubles(
  device: TrashItem[],
  account: readonly AccountNote[],
): Promise<TrashItem[]> {
  const doubles = new Set(doublesOf(device, account, folderOfSpace))
  if (!doubles.size) return device
  for (const item of device) {
    if (doubles.has(item.id)) await invoke('purge_trash', { id: item.ref }).catch(() => undefined)
  }
  return device.filter((item) => !doubles.has(item.id))
}
