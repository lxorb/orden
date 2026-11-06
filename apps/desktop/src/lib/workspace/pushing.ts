import { account } from '../account.svelte'
import { api } from '../api'
import { sync } from '../sync.svelte'

type Save = (calls: typeof api, token: string, spaceId: string) => Promise<unknown>

export async function push(
  root: string,
  save: Save,
  heard: (landed: boolean) => void = () => undefined,
): Promise<void> {
  const token = account.token
  const spaceId = sync.remoteIdFor(root)
  const role = spaceId ? account.spaces.find((one) => one.id === spaceId)?.role : undefined

  if (!token || !spaceId || role === 'read') {
    heard(true)
    return
  }

  const landed = await save(api, token, spaceId)
    .then(() => true)
    .catch(() => false)

  heard(landed)
  if (landed) await account.loadSpaces().catch(() => undefined)
}
