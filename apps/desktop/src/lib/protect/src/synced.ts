import { syncStore } from '@orden/contracts'
import { account, request } from '../../accounts/src/api'
import { isRecord } from '../../platform/src/api'
import { hashedOf, protectedMap, type Way, protection } from './protection.svelte'

interface Remote {
  password: unknown
  spaces: Record<string, unknown>
}

function remoteOf(value: unknown): Remote | null {
  if (!isRecord(value) || !isRecord(value.spaces)) return null
  return { password: value.password, spaces: value.spaces }
}

const queued = new Map<string, Promise<void>>()
const stirred = new Map<string, number>()

const alike = (one: Record<string, Way>, other: Record<string, Way>) =>
  Object.keys(one).length === Object.keys(other).length &&
  Object.entries(one).every(([key, way]) => other[key] === way)

const stir = (root: string) => stirred.set(root, (stirred.get(root) ?? 0) + 1)

export function pushWays(root: string): Promise<void> {
  stir(root)
  const next = (queued.get(root) ?? Promise.resolve()).then(() => pushNow(root))
  queued.set(root, next)
  return next
}

async function pushNow(root: string): Promise<void> {
  const token = account.token
  const spaceId = syncStore()?.remoteIdFor(root) ?? null
  if (!token || !spaceId) return
  const ways: Record<string, Way> = protection.ways(root)
  const landed = await request(`/v1/protected/spaces/${encodeURIComponent(spaceId)}`, {
    method: 'PUT',
    token,
    body: { protected: ways },
  }).then(
    () => true,
    () => false,
  )
  stir(root)
  protection.said(root, landed && alike(ways, protection.ways(root)))
}

export async function pushPassword(
  token = account.token,
  accountId = account.user?.id ?? null,
): Promise<void> {
  const password = protection.password
  if (!token || !accountId || !password) return
  protection.ownedBy(accountId)
  await request('/v1/protected/password', { method: 'PUT', token, body: { password } }).catch(
    () => undefined,
  )
}

export async function pulled(
  token: string,
  accountId: string,
  pairs: readonly { root: string; spaceId: string }[],
): Promise<void> {
  const before = new Map(pairs.map(({ root }) => [root, stirred.get(root) ?? 0]))
  const remote = remoteOf(await request<unknown>('/v1/protected', { token }).catch(() => null))
  if (!remote) return
  for (const { root, spaceId } of pairs) {
    if ((stirred.get(root) ?? 0) !== before.get(root)) continue
    const theirs = protectedMap(remote.spaces[spaceId])
    if (protection.adopt(root, theirs, accountId)) await pushWays(root)
  }
  if (protection.adoptPassword(hashedOf(remote.password), accountId)) {
    await pushPassword(token, accountId)
  }
}
