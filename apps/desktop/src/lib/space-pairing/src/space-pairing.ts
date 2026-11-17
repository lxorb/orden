import type { SyncPairing } from '@orden/contracts'
import { account, api } from '../../accounts/src/api'
import {
  forgetHome,
  homeOf,
  keepHomes,
  leaveSpaces,
  leftByAnother,
} from '../../left-spaces/src/api'
import { forgetSeedSpace, seedSpaceRoot } from '../../seeded/src/api'
import { untouchedSeedSpace } from './seed-space'
import { planSpaces } from './space-plan'
import { samePath, invoke, isNative } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import {
  endsOwed,
  holder,
  iconOwed,
  orderSent,
  sendIcon,
  settleEnds,
  settleNames,
} from '../../space-owed/src/api'

const inTheAir = new WeakMap<SyncPairing, Promise<void>>()

let last: Promise<unknown> = Promise.resolve()

export function pairSpaces(token: string, pairing: SyncPairing): Promise<void> {
  const running = inTheAir.get(pairing)
  if (running) return running
  const now = last
    .catch(() => undefined)
    .then(() => pairOnce(token, pairing))
    .finally(rolesPaired)
    .finally(() => inTheAir.delete(pairing))
  last = now
  inTheAir.set(pairing, now)
  return now
}

async function rolesPaired(): Promise<void> {
  ;(await import('../../sharing/src/api')).rememberRoles()
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

async function endsSettled(token: string, who: string): Promise<Set<string>> {
  await settleNames(token, who)
  const owed = endsOwed(who)
  if (owed.size) await settleEnds(token, who)
  return owed
}

async function iconSent(token: string, who: string, spaceId: string): Promise<boolean> {
  const owed = iconOwed(who, spaceId)
  if (owed) await sendIcon(token, who, spaceId, owed)
  return owed !== null
}

async function pairOnce(token: string, pairing: SyncPairing): Promise<void> {
  await workspace.spacesKnown()
  const seeded = seedSpaceRoot()
  const who = account.user?.id ?? null
  const theirs = (root: string) => leftByAnother(root, who)
  if (!isNative && workspace.spaces.some((space) => theirs(space.root))) {
    await workspace.loadSpaces()
  }
  const mirrors = pairing.pairs()
  const owes = holder()
  const ending = owes === null ? new Set<string>() : await endsSettled(token, owes)
  const kept = new Set(mirrors.map((one) => one.spaceId))
  const local = workspace.spaces
    .filter((space) => !theirs(space.root))
    .map((space) => ({ name: space.name, root: space.root }))
  const plan = planSpaces({
    local,
    remote: account.spaces
      .filter((space) => !ending.has(space.id) || kept.has(space.id))
      .map((space) => ({
        id: space.id,
        name: space.name,
        shared: space.role !== 'owner',
      })),
    mirrors,
    homes: local.flatMap(({ root }) => {
      const spaceId = homeOf(root, who)
      return spaceId === null ? [] : [{ root, spaceId }]
    }),
    deleted: account.deletedSpaces,
    untouched: await untouchedDefault(),
  })

  for (const root of plan.remove) {
    const space = workspace.spaces.find((one) => samePath(one.root, root))
    pairing.unpair(root)
    if (space) await workspace.deleteSpace(space.id, true)
    forgetHome(root)
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
    if (owes !== null && endsOwed(owes).has(space.id)) continue
    const taken =
      shared(space.id) ||
      workspace.spaces.some(
        (one) =>
          one.name === space.name &&
          (theirs(one.root) || paired().some((pair) => samePath(pair.root, one.root))),
      )

    const root = await workspace.adoptSpace(space.name, taken, space.id)
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
    keepHomes(
      who,
      paired().filter((one) => !theirs(one.root)),
    )
  }

  const accountId = account.user?.id ?? null
  for (const remote of account.spaces) {
    const pair = paired().find((one) => one.spaceId === remote.id)
    if (!pair) continue
    const root = workspace.spaces.find((one) => samePath(one.root, pair.root))?.root ?? pair.root

    const owed = owes === null ? false : await iconSent(token, owes, remote.id)
    const unsaid = owed ? null : workspace.applyIcon(root, remote.icon ?? null, remote.tint)
    if (unsaid && remote.role === 'owner') {
      await api.setSpaceIcon(token, remote.id, remote.icon ?? null, unsaid).catch(() => undefined)
      await account.loadSpaces().catch(() => undefined)
    }

    pairing.share(pair.root, remote.role !== 'owner')

    if (accountId === null || remote.role === 'read') continue
    const merged = workspace.bookmarks.adopt(root, remote.bookmarks, accountId)
    if (merged) {
      const landed = await api.saveBookmarks(token, remote.id, merged).then(
        () => true,
        () => false,
      )
      workspace.bookmarks.said(root, landed, merged)
    }
  }

  if (accountId !== null && !__EVEN_PLUGIN__) {
    const pairs = paired()
    void import('../../protect/src/api').then(
      (one) => one.pulled(token, accountId, pairs),
      () => undefined,
    )
  }

  if (owes !== null && (await orderSent(token, owes))) return
  const order = paired()
  workspace.applySpaceOrder(
    account.spaces.flatMap((space) => {
      const pair = order.find((one) => one.spaceId === space.id)
      return pair ? [pair.root] : []
    }),
  )
}
