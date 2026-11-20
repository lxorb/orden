import { syncStore } from '@orden/contracts'
import { account, api } from '../../accounts/src/api'

type Save<T> = (calls: typeof api, token: string, spaceId: string) => Promise<T>
export async function push<T>(
  root: string,
  save: Save<T>,
  heard: (landed: boolean) => void = () => undefined,
  kept: (answer: T) => boolean = () => true,
): Promise<void> {
  const token = account.token
  const spaceId = syncStore()?.remoteIdFor(root) ?? null
  const role = spaceId ? account.spaces.find((one) => one.id === spaceId)?.role : undefined
  if (role === 'read') {
    heard(true)
    return
  }
  if (!token || !spaceId) {
    heard(false)
    return
  }
  const landed = await save(api, token, spaceId)
    .then(kept)
    .catch(() => false)
  heard(landed)
  if (landed) await account.loadSpaces().catch(() => undefined)
}
export const keepsAll = (
  answer: Readonly<Record<string, unknown>> | undefined,
  sent: Readonly<Record<string, unknown>>,
): boolean => Object.entries(sent).every(([key, one]) => answer?.[key] === one)
