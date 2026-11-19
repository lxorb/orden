import { syncStore } from '@orden/contracts'
import { account, request } from '../../accounts/src/api'
import { isRecord, keepJson, stored } from '../../platform/src/api'
import { hashedOf, protectedMap, type Way, protection } from './protection.svelte'

interface Remote {
  password: unknown
  spaces: Record<string, unknown>
}
function remoteOf(value: unknown): Remote | null {
  if (!isRecord(value) || !isRecord(value.spaces)) return null
  return { password: value.password, spaces: value.spaces }
}
const BASE_KEY = 'orden:protected-base'
interface Base {
  space: string
  ways: Record<string, Way>
}
function bases(): Record<string, Base> {
  const saved = stored(BASE_KEY)
  if (!isRecord(saved)) return {}
  const out: Record<string, Base> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (isRecord(one) && typeof one.space === 'string') {
      out[root] = { space: one.space, ways: protectedMap(one.ways) }
    }
  }
  return out
}
const baseOf = (root: string, space: string) => {
  const known = bases()[root]
  return known?.space === space ? known.ways : null
}
const keepBase = (root: string, space: string, ways: Record<string, Way>) =>
  keepJson(BASE_KEY, { ...bases(), [root]: { space, ways } })
const queued = new Map<string, Promise<void>>()
const STIRRED_KEY = 'orden:protected-stirred'
function stirredOf(root: string): number {
  const all = stored(STIRRED_KEY)
  const one = isRecord(all) ? all[root] : undefined
  return typeof one === 'number' ? one : 0
}
const alike = (one: Record<string, Way>, other: Record<string, Way>) =>
  Object.keys(one).length === Object.keys(other).length && Object.entries(one).every(([key, way]) => other[key] === way)
function stir(root: string): void {
  const all = stored(STIRRED_KEY)
  keepJson(STIRRED_KEY, { ...(isRecord(all) ? all : {}), [root]: stirredOf(root) + 1 })
}
export function pushWays(root: string): Promise<void> {
  stir(root)
  const next = (queued.get(root) ?? Promise.resolve()).then(() => pushNow(root))
  queued.set(root, next)
  return next
}
async function based(root: string, spaceId: string, token: string) {
  const known = baseOf(root, spaceId)
  if (known) return known
  protection.said(root, false)
  const accountId = account.user?.id
  const remote = remoteOf(await request<unknown>('/v1/protected', { token }).catch(() => null))
  if (!remote || !accountId) return null
  const theirs = protectedMap(remote.spaces[spaceId])
  keepBase(root, spaceId, theirs)
  protection.adopt(root, theirs, accountId)
  return theirs
}
async function pushNow(root: string): Promise<void> {
  const token = account.token
  const spaceId = syncStore()?.remoteIdFor(root) ?? null
  if (!token || !spaceId) return
  const base = await based(root, spaceId, token)
  if (!base) return
  const ways: Record<string, Way> = protection.ways(root)
  const answer = await request<unknown>(`/v1/protected/spaces/${encodeURIComponent(spaceId)}`, {
    method: 'PUT',
    token,
    body: { protected: ways, base },
  }).then(
    (said) => remoteOf(said) ?? remoteOf({ spaces: { [spaceId]: ways } }),
    () => null,
  )
  stir(root)
  const now = alike(ways, protection.ways(root))
  protection.said(root, answer !== null && now, ways)
  if (!answer) return
  const held = protectedMap(answer.spaces[spaceId])
  if (now) keepBase(root, spaceId, held)
  const accountId = account.user?.id
  if (now && accountId && !alike(held, ways)) protection.adopt(root, held, accountId)
}
export async function pushPassword(token = account.token, accountId = account.user?.id ?? null): Promise<void> {
  const password = protection.password
  if (!token || !accountId || !password) return
  protection.ownedBy(accountId)
  await request('/v1/protected/password', { method: 'PUT', token, body: { password } }).catch(() => undefined)
}
export async function pulled(
  token: string,
  accountId: string,
  pairs: readonly { root: string; spaceId: string }[],
): Promise<void> {
  const before = new Map(pairs.map(({ root }) => [root, stirredOf(root)]))
  const remote = remoteOf(await request<unknown>('/v1/protected', { token }).catch(() => null))
  if (!remote) return
  for (const { root, spaceId } of pairs) {
    if (stirredOf(root) !== before.get(root)) continue
    const theirs = protectedMap(remote.spaces[spaceId])
    if (!baseOf(root, spaceId)) protection.said(root, false)
    keepBase(root, spaceId, theirs)
    if (protection.adopt(root, theirs, accountId)) await pushWays(root)
  }
  if (protection.adoptPassword(hashedOf(remote.password), accountId)) {
    await pushPassword(token, accountId)
  }
}
