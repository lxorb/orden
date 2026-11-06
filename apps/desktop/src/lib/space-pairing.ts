import { account } from './account.svelte'
import { api } from './api'
import { forgetSeedSpace, seedSpaceRoot } from './seeded'
import { untouchedSeedSpace } from './seed-space'
import { planSpaces } from './space-plan'
import { invoke } from './tauri'
import { workspace } from './workspace.svelte'

export interface Pairing {
  pairs(): { root: string; spaceId: string; shared: boolean }[]
  pair(root: string, spaceId: string, shared: boolean): void
  unpair(root: string): void
  share(root: string, shared: boolean): void
}

const inTheAir = new WeakMap<Pairing, Promise<void>>()

export function pairSpaces(token: string, pairing: Pairing): Promise<void> {
  const running = inTheAir.get(pairing)
  if (running) return running
  const now = pairOnce(token, pairing)
    .finally(rolesPaired)
    .finally(() => inTheAir.delete(pairing))
  inTheAir.set(pairing, now)
  return now
}

async function rolesPaired(): Promise<void> {
  ;(await import('./sharing.svelte')).rememberRoles()
}

async function untouchedDefault(): Promise<string | null> {
  if (!account.user) return null
  return await untouchedSeedSpace(
    seedSpaceRoot(),
    workspace.spaces.map((space) => space.root),
    {
      tree: (root) => invoke('read_tree', { root }),
      note: (path) => invoke<string>('read_note', { path }),
    },
  )
}

async function pairOnce(token: string, pairing: Pairing): Promise<void> {
  const seeded = seedSpaceRoot()
  const plan = planSpaces({
    local: workspace.spaces.map((space) => ({ name: space.name, root: space.root })),
    remote: account.spaces.map((space) => ({
      id: space.id,
      name: space.name,
      shared: space.role !== 'owner',
    })),
    mirrors: pairing.pairs(),
    deleted: account.deletedSpaces,
    untouched: await untouchedDefault(),
  })

  for (const root of plan.remove) {
    const space = workspace.spaces.find((one) => one.root === root)
    pairing.unpair(root)
    if (space) await workspace.deleteSpace(space.id, true)
  }

  for (const root of plan.discard) {
    const space = workspace.spaces.find((one) => one.root === root)
    if (space) await workspace.deleteSpace(space.id, true)
    forgetSeedSpace()
  }

  for (const root of [...plan.detach, ...plan.drop]) pairing.unpair(root)

  const shared = (id: string) => account.spaces.find((one) => one.id === id)?.role !== 'owner'

  for (const { root, spaceId } of plan.pair) pairing.pair(root, spaceId, shared(spaceId))

  if (account.user) {
    for (const space of plan.upload) {
      const { space: remote } = await api.createSpace(token, space.name)
      pairing.pair(space.root, remote.id, false)
    }
  }

  if (seeded !== null && pairing.pairs().some((one) => one.root === seeded)) forgetSeedSpace()

  const paired = () => pairing.pairs()
  for (const space of plan.adopt) {
    const taken =
      shared(space.id) ||
      workspace.spaces.some(
        (one) => one.name === space.name && paired().some((pair) => pair.root === one.root),
      )

    const root = await workspace.adoptSpace(space.name, taken)
    if (root) pairing.pair(root, space.id, shared(space.id))
  }

  const accountId = account.user?.id ?? null
  for (const remote of account.spaces) {
    const pair = paired().find((one) => one.spaceId === remote.id)
    if (!pair) continue

    const unsaid = workspace.applyIcon(pair.root, remote.icon ?? null, remote.tint)
    if (unsaid && remote.role === 'owner') {
      await api.setSpaceIcon(token, remote.id, remote.icon ?? null, unsaid).catch(() => undefined)
      await account.loadSpaces().catch(() => undefined)
    }

    pairing.share(pair.root, remote.role !== 'owner')

    if (accountId === null || remote.role === 'read') continue
    const merged = workspace.bookmarks.adopt(pair.root, remote.bookmarks, accountId)
    if (merged) {
      const landed = await api.saveBookmarks(token, remote.id, merged).then(
        () => true,
        () => false,
      )
      workspace.bookmarks.said(pair.root, landed, merged)
    }
  }

  workspace.applySpaceOrder(account.spaces.map((space) => space.name))
}
