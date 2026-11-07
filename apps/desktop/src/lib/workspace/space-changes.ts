import { account } from '../account.svelte'
import { identifier } from '../identifier'
import { leftGone, leftMoved } from '../left-spaces'
import { samePath } from '../space-paths'
import { forgetSpaceViews } from '../views/kept-views'
import { invoke } from '../tauri'
import { windows } from '../windows'
import type { Space } from '../workspace.svelte'
import { type HoldsSpaces, selectSpace, tabSets } from './spaces'

export async function adoptSpace(
  ws: HoldsSpaces,
  name: string,
  fresh = false,
): Promise<string | null> {
  const existing = fresh ? undefined : ws.spaces.find((space) => space.name === name)
  if (existing) return existing.root

  const created = await invoke<{ name: string; path: string }>('create_space', {
    name: name.trim(),
  }).catch(() => null)

  if (!created) return null

  if (!ws.spaces.some((space) => samePath(space.root, created.path))) {
    const space: Space = { id: identifier(), name: created.name, root: created.path }
    ws.spaces = [...ws.spaces, space]
    windows.say('spaces-again')

    if (ws.activeSpaceId) ws.persist()
    else await selectSpace(ws, space.id)
  }

  return created.path
}

export async function addSpace(ws: HoldsSpaces, name: string) {
  if (!name.trim()) return

  const created = await invoke<{ name: string; path: string }>('create_space', {
    name: name.trim(),
  }).catch(() => null)

  if (!created) return

  const listed = ws.spaces.find((one) => samePath(one.root, created.path))
  const space: Space = listed ?? { id: identifier(), name: created.name, root: created.path }
  if (!listed) ws.spaces = [...ws.spaces, space]
  windows.say('spaces-again')
  await selectSpace(ws, space.id)
  return space
}

export async function renameSpace(ws: HoldsSpaces, id: string, name: string) {
  const space = ws.spaces.find((entry) => entry.id === id)
  if (!space || !name.trim()) return

  ws.naming = null

  const done = { moved: false }
  const { followSpaceName } = await import('../views/space-follow')
  await ws.holdingUnder(space.root, async () => {
    const renamed = await invoke<{ name: string; path: string }>('rename_space', {
      from: space.root,
      name: name.trim(),
    }).catch(() => null)

    if (!renamed) return

    const from = space.root
    const was = space.name
    space.name = renamed.name
    space.root = renamed.path
    followSpaceName(
      was,
      renamed.name,
      ws.tabs,
      ws.spaces.filter((one) => one !== space),
    )
    leftMoved(from, renamed.path)
    await ws.fileMoved(from, renamed.path, 'space')
    done.moved = true
  })

  if (!done.moved) return
  if (ws.activeSpaceId === id) await ws.loadTree()
  ws.persist()
}

export async function deleteSpace(ws: HoldsSpaces, id: string, keep = false) {
  const space = ws.spaces.find((entry) => entry.id === id)
  if (!space) return

  {
    const toAccount = account.signedIn && !keep && (await accountHoldsSpace(space.root))
    const gone = await (
      toAccount
        ? invoke('delete_space', { path: space.root })
        : invoke('trash_item', { path: space.root, kind: 'space' })
    )
      .then(() => true)
      .catch(() => false)

    if (!gone) return
    if (toAccount) leftGone(space.root)
  }

  await spaceGone(ws, space)
}

export async function dropSpace(ws: HoldsSpaces, id: string) {
  const space = ws.spaces.find((entry) => entry.id === id)
  if (!space) return
  await invoke('delete_space', { path: space.root })
  const trash = await invoke<{ id: string; from: string }[]>('list_trash').catch(() => [])
  for (const one of trash) {
    if (samePath(one.from, space.root) || one.from.startsWith(`${space.root}/`)) {
      await invoke('purge_trash', { id: one.id }).catch(() => undefined)
    }
  }
  leftGone(space.root)
  await spaceGone(ws, space)
}

async function spaceGone(ws: HoldsSpaces, space: Space) {
  const id = space.id
  await ws.fileGone(space.root, 'space')
  ws.spaces = ws.spaces.filter((entry) => entry.id !== id)
  if (!ws.spaces.some((entry) => entry.name === space.name)) {
    forgetSpaceViews(space.name)
    const { forgetSpaceTabs } = await import('../views/space-follow')
    forgetSpaceTabs(space.name, ws.tabs)
  }
  const fetched =
    tabSets.fetched || ws.setsRead !== undefined || ws.tabs.length
      ? (await import('./sets.svelte')).sets
      : null

  if (ws.activeSpaceId === id) {
    ws.activeSpaceId = ws.spaces[0]?.id ?? null
    ws.tree = null
    if (ws.activeSpaceId) await selectSpace(ws, ws.activeSpaceId)
  }
  await fetched?.gone(id)
  ws.persist()
}

export async function mayEndSpace(ws: HoldsSpaces, id: string): Promise<boolean> {
  const tabs = tabSets.fetched
    ? (await import('./sets.svelte')).sets.tabsOf(id)
    : ws.activeSpaceId === id
      ? ws.tabs
      : []
  if (!tabs.some((tab) => tab.kind === 'terminal')) return true
  const { mayEnd } = await import('../terminal/closing')
  return await mayEnd(tabs)
}

async function accountHoldsSpace(root: string): Promise<boolean> {
  const { sync } = await import('../sync.svelte')
  const id = sync.remoteIdFor(root)
  if (id === null) return false
  if (account.spaces.find((one) => one.id === id)?.role !== 'owner') return false
  const { accountHoldsAll } = await import('./undoing')
  return accountHoldsAll(root, (one, how) => sync.holds(one, how))
}
