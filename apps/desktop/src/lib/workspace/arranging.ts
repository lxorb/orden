import { arrangedMap, type Arranged } from './arranged.svelte'
import { type Folding, meet } from '../records'

function same(one: Record<string, string[]>, other: Record<string, string[]>): boolean {
  const keys = Object.keys(one)
  if (keys.length !== Object.keys(other).length) return false

  return keys.every((key) => {
    const mine = one[key] ?? []
    const theirs = other[key] ?? []
    return mine.length === theirs.length && mine.every((name, at) => name === theirs[at])
  })
}

const ORDERS: Folding<Record<string, string[]>> = {
  fold: (theirs, mine) => ({ ...theirs, ...mine }),
  same,
}

export async function fold(
  store: Arranged,
  root: string,
  theirs: unknown,
  accountId: string,
): Promise<void> {
  const account = arrangedMap(theirs)
  const held = store.kept(root)
  const met = meet(held, accountId, held.folders, account, ORDERS)
  if (!met) return

  store.took(root, met.value, accountId)
  if (met.tell) await send(store, root)
}

export async function send(store: Arranged, root: string): Promise<void> {
  const { push } = await import('./pushing')
  await push(
    root,
    (api, token, spaceId) => api.saveArranged(token, spaceId, store.of(root)),
    (landed) => store.said(root, landed),
  )
}
