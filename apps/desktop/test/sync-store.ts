import { providePort, type SyncStorePort } from '@orden/contracts'

const QUIET: SyncStorePort = {
  engineReady: true,
  passing: false,
  pass: () => Promise.resolve(),
  nudge: () => undefined,
  remoteIdFor: () => null,
  roleKept: () => null,
  pushBookmarks: () => Promise.resolve(),
  pathOf: () => null,
  idOf: () => null,
  moved: () => undefined,
  entryIdAt: () => null,
  entryPathOf: () => null,
}
export function serveSyncStore(given: Partial<SyncStorePort> = {}): () => void {
  return providePort('sync.store', { ...QUIET, ...given })
}
