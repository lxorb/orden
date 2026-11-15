import { account, request } from '../../accounts/src/api'
import { isRecord } from '../../platform/src/api'
import { sync } from '../../sync.svelte'
import { hashedOf, protectedMap, type Way, protection } from './protection.svelte'

interface Remote {
  password: unknown
  spaces: Record<string, unknown>
}

function remoteOf(value: unknown): Remote | null {
  if (!isRecord(value) || !isRecord(value.spaces)) return null
  return { password: value.password, spaces: value.spaces }
}

export async function pushWays(root: string): Promise<void> {
  const token = account.token
  const spaceId = sync.remoteIdFor(root)
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
  protection.said(root, landed)
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
  const remote = remoteOf(await request<unknown>('/v1/protected', { token }).catch(() => null))
  if (!remote) return
  for (const { root, spaceId } of pairs) {
    const theirs = protectedMap(remote.spaces[spaceId])
    if (protection.adopt(root, theirs, accountId)) await pushWays(root)
  }
  if (protection.adoptPassword(hashedOf(remote.password), accountId)) {
    await pushPassword(token, accountId)
  }
}
