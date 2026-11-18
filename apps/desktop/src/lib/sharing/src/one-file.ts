import { syncStore, workspaceView } from '@orden/contracts'
import type { SharedItem } from '../../accounts/src/api'
import { account } from '../../accounts/src/api'
import { insideSpace, spaceHolding, waited } from '../../platform/src/api'
import { sharedWithYou } from './sharing.svelte'

const LOOK = 150
const PATIENCE = 20_000

function keptAt(item: SharedItem): string | null {
  const store = syncStore()
  const space = workspaceView().spaces.find((one) => store?.remoteIdFor(one.root) === item.space.id)
  const path = space ? insideSpace(space.root, item.path) : null
  return path && store?.idOf(path) === item.id ? path : null
}

async function openWhereKept(item: SharedItem): Promise<boolean> {
  if (!account.user) return false

  const holds = () => account.spaces.some((one) => one.id === item.space.id)
  if (!holds()) await account.loadSpaces().catch(() => undefined)
  if (!holds()) return false

  const until = Date.now() + PATIENCE
  let path = keptAt(item)
  while (!path && Date.now() < until) {
    const store = syncStore()
    if (store?.engineReady && !store.passing) await store.pass()
    await waited(LOOK)
    path = keptAt(item)
  }
  if (!path) return false

  const view = workspaceView()
  const space = spaceHolding(view.spaces, path)
  if (space) await view.showSpace(space.id)
  await view.openEntry(path)
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
