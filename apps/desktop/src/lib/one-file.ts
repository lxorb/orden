import type { SharedItem } from './accounts/src/api'
import { account } from './accounts/src/api'
import { sharedWithYou } from './sharing.svelte'
import { insideSpace, within } from './space-paths'
import { sync } from './sync.svelte'
import { waited } from './timing'
import { workspace } from './workspace.svelte'

const LOOK = 150
const PATIENCE = 20_000

function keptAt(item: SharedItem): string | null {
  const space = workspace.spaces.find((one) => sync.remoteIdFor(one.root) === item.space.id)
  const path = space ? insideSpace(space.root, item.path) : null
  return path && sync.tracked(path)?.id === item.id ? path : null
}

async function openWhereKept(item: SharedItem): Promise<boolean> {
  if (!account.user) return false

  const holds = () => account.spaces.some((one) => one.id === item.space.id)
  if (!holds()) await account.loadSpaces().catch(() => undefined)
  if (!holds()) return false

  const until = Date.now() + PATIENCE
  let path = keptAt(item)
  while (!path && Date.now() < until) {
    if (!(sync.version === 2 && !sync.engine) && !sync.passing) await sync.pass()
    await waited(LOOK)
    path = keptAt(item)
  }
  if (!path) return false

  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (space) await workspace.showSpace(space.id)
  await workspace.openEntry(path)
  return true
}

export async function landOn(item: SharedItem): Promise<void> {
  if (await openWhereKept(item)) return

  await sharedWithYou.load()
  await sharedWithYou.open(item)
}

export async function backToTheFile(): Promise<void> {
  if (account.user || account.spaces.length) return

  const [only, ...more] = sharedWithYou.items
  if (only && !more.length) await sharedWithYou.open(only)
}
