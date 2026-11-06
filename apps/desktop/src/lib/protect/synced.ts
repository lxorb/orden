import { account } from '../account.svelte'
import { request } from '../api'
import { isRecord } from '../stored'
import { sync } from '../sync.svelte'
import { workspace } from '../workspace.svelte'
import { hashedOf, protectedMap, type Way } from './protection.svelte'

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
  const ways: Record<string, Way> = workspace.protection.ways(root)
  const landed = await request(`/v1/protected/spaces/${encodeURIComponent(spaceId)}`, {
    method: 'PUT',
    token,
    body: { protected: ways },
  }).then(
    () => true,
    () => false,
  )
  workspace.protection.said(root, landed)
}

export async function pushPassword(): Promise<void> {
  const token = account.token
  const password = workspace.protection.password
  if (!token || !password) return
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
    if (workspace.protection.adopt(root, theirs, accountId)) await pushWays(root)
  }
  if (workspace.protection.adoptPassword(hashedOf(remote.password))) await pushPassword()
}
