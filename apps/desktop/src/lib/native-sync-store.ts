import { frame, unframe } from '@orden/sync-core'
import { invoke } from './native'
import {
  answerOf,
  changeOf,
  countsOf,
  openedOf,
  queryOf,
  StoreError,
  type Answers,
  type Change,
  type Query,
  type SyncStore,
} from './sync2/store'

export async function openNative(
  account: string,
  lead = false,
  device?: string,
): Promise<SyncStore> {
  const opened = openedOf(await invoke('sync_store_open', { account, lead, device }))

  return {
    opened,
    async read<const Q extends readonly Query[]>(queries: Q): Promise<Answers<Q>> {
      for (const query of queries) queryOf(query)
      const answered = unframe(bytesOf(await invoke('sync_store_read', { queries })))
      if (!Array.isArray(answered) || answered.length !== queries.length) {
        throw new StoreError('the sync store answered an odd read')
      }
      return queries.map((query, at) => answerOf(query, answered[at])) as Answers<Q>
    },
    async write(changes: readonly Change[]): Promise<number[]> {
      for (const change of changes) changeOf(change)
      return countsOf(await invoke('sync_store_write', frame(changes)), changes.length)
    },
    cleanExit: (clean) => invoke('sync_store_clean_exit', { clean }),
    close: () => invoke('sync_store_close'),
  }
}

export async function deviceNative(account: string): Promise<string | null> {
  const device = await invoke<unknown>('sync_store_device', { account })
  return typeof device === 'string' ? device : null
}

export function forgetNative(account: string): Promise<void> {
  return invoke('sync_store_forget', { account })
}

export function bytesOf(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (Array.isArray(raw) && raw.every((one) => Number.isInteger(one) && one >= 0 && one < 256)) {
    return Uint8Array.from(raw as number[])
  }
  throw new StoreError('the sync store answered something that is not bytes')
}
