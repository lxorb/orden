import { account } from './account.svelte'
import { api } from './api'
import { leaveSpaces, leftByAnother } from './left-spaces'
import { forgetSeedSpace, seedSpaceRoot } from './seeded'
import { untouchedSeedSpace } from './seed-space'
import { planSpaces } from './space-plan'
import { samePath } from './space-paths'
import { invoke, isNative } from './tauri'
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
  const who = account.user?.id ?? null
  const theirs = (root: string) => leftByAnother(root, who)
  if (!isNative && workspace.spaces.some((space) => theirs(space.root))) {
    await workspace.loadSpaces()
  }
  const plan = planSpaces({
    local: workspace.spaces
      .filter((space) => !theirs(space.root))
      .map((space) => ({ name: space.name, root: space.root })),
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
    const space = workspace.spaces.find((one) => samePath(one.root, root))
    pairing.unpair(root)
    if (space) await workspace.deleteSpace(space.id, true)
  }

  for (const root of plan.discard) {
    const space = workspace.spaces.find((one) => samePath(one.root, root))
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
      if (who) leaveSpaces(who, [space.root])
    }
  }

  if (seeded !== null && pairing.pairs().some((one) => samePath(one.root, seeded)))
    forgetSeedSpace()

  const paired = () => pairing.pairs()
  for (const space of plan.adopt) {
    const taken =
      shared(space.id) ||
      workspace.spaces.some(
        (one) =>
          one.name === space.name &&
          (theirs(one.root) || paired().some((pair) => samePath(pair.root, one.root))),
      )

    const root = await workspace.adoptSpace(space.name, taken)
    if (root) pairing.pair(root, space.id, shared(space.id))
    if (root && who) leaveSpaces(who, [root])
  }

  if (who) {
    leaveSpaces(who, [
      ...plan.pair.map((one) => one.root),
      ...paired()
        .map((one) => one.root)
        .filter((root) => !theirs(root)),
    ])
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

  if (accountId !== null && !__EVEN_PLUGIN__) {
    const pairs = paired()
    void import('./protect/synced').then(
      (one) => one.pulled(token, accountId, pairs),
      () => undefined,
    )
  }

  workspace.applySpaceOrder(account.spaces.map((space) => space.name))
}
