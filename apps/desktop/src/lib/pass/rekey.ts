import { open, seal } from '@orden/pass/crypto'

export async function rekeyed(
  from: readonly Uint8Array<ArrayBuffer>[],
  to: Uint8Array<ArrayBuffer>,
  vault: string,
  id: string,
  sealed: string,
): Promise<string | null> {
  for (const key of from) {
    try {
      const itemKey = await open(key, sealed, 'item-key', vault, id)
      return await seal(to, itemKey, 'item-key', vault, id)
    } catch {
      continue
    }
  }
  return null
}
