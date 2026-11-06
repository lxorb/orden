import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { keepJson, stored } from './stored'
import { type Space, workspace } from './workspace.svelte'

const OWED_KEY = 'nib:archived-spaces-owed'

let heard: readonly string[] | null = null

export function canArchive(space: Space): boolean {
  const shown = workspace.shownSpaces
  return shown.length > 1 && shown.some((one) => one.id === space.id)
}

export async function archiveSpace(space: Space): Promise<void> {
  if (!canArchive(space)) return

  if (workspace.activeSpaceId === space.id) {
    const shown = workspace.shownSpaces
    const at = shown.findIndex((one) => one.id === space.id)
    const next = shown[at + 1] ?? shown[at - 1]
    if (next) await workspace.showSpace(next.id)
  }

  if (workspace.archivedSpaces.set(space.root, true)) await tell()
}

export async function unarchiveSpace(space: Space): Promise<void> {
  if (workspace.archivedSpaces.set(space.root, false)) await tell()
}

export function archivedSpaces(): Space[] {
  return workspace.spaces.filter((one) => workspace.archivedSpaces.has(one.root))
}

export async function receive(remote: AccountSettings): Promise<void> {
  if (!Array.isArray(remote.archivedSpaces)) return
  heard = remote.archivedSpaces.filter((id): id is string => typeof id === 'string')
  await listed()
}

export async function listed(): Promise<void> {
  if (stored(OWED_KEY) === true) await tell()
  else await reconcile()
}

export async function reconcile(): Promise<void> {
  if (heard === null || stored(OWED_KEY) === true) return
  const { sync } = await import('./sync.svelte')
  const said = new Set(heard)

  for (const space of workspace.spaces) {
    const id = sync.remoteIdFor(space.root)
    if (id === null) continue
    const away = said.has(id)
    if (away && workspace.shownSpaces.length < 2 && !workspace.archivedSpaces.has(space.root)) {
      continue
    }
    workspace.archivedSpaces.set(space.root, away)
  }

  const open = workspace.activeSpace
  if (open && workspace.archivedSpaces.has(open.root)) {
    const next = workspace.shownSpaces[0]
    if (next) await workspace.showSpace(next.id)
    else workspace.archivedSpaces.set(open.root, false)
  }
}

async function tell(): Promise<void> {
  const token = account.accountToken
  if (!token) return
  keepJson(OWED_KEY, true)

  const { sync } = await import('./sync.svelte')
  const idOf = (space: Space) => sync.remoteIdFor(space.root)
  const known = new Set(workspace.spaces.map(idOf))
  const theirs = (heard ?? []).filter((id) => !known.has(id))
  const ids = [
    ...theirs,
    ...archivedSpaces()
      .map(idOf)
      .filter((id): id is string => id !== null),
  ]
  try {
    await api.saveSettings(token, { archivedSpaces: ids })
    heard = ids
    keepJson(OWED_KEY, false)
  } catch {
    // Still owed; the next start or listing sends it.
  }
}
