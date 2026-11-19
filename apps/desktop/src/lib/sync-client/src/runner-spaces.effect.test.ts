import '../../sync-ports'
import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'
import { hash32 } from '@orden/sync-core'
import { root, watch } from '../../../../test/effects/runes.svelte'

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>()
  return {
    ...original,
    openSyncStore: async (id: string) => {
      const { MemoryStore } = await import('./memory-store')
      return new MemoryStore(id).open()
    },
    forgetSyncStore: () => Promise.resolve(),
  }
})
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
}))
vi.mock('./watching', () => ({
  watchFolders: () => ({ stop: () => undefined, follow: () => undefined }),
}))
const { MemoryDisk } = await import('./memory-disk')
vi.mock('./app-world', () => ({
  appWorld: () => ({
    disk: new MemoryDisk(),
    account: { ask: () => Promise.resolve(null) },
    name: 'here',
    now: () => 1000,
    random: Math.random,
    digest: (text: string) => Promise.resolve(String(hash32('a', text))),
    join: (root: string, path: string) => `${root}/${path}`,
    foldsCase: true,
    platform: 'other',
  }),
}))
const { runner } = await import('./runner.svelte')
const { account } = await import('../../accounts/src/account.svelte')
test('a space paired after the sidebar asked which it is reaches the sidebar (#2071)', async () => {
  const seen: (string | null)[] = []
  const stop = root(() => watch(() => void seen.push(runner.remoteIdFor('/Spaces/Team'))))
  flushSync()
  expect(seen).toEqual([null])
  Object.assign(account, { user: { id: 'u7', syncVersion: 2 } })
  try {
    await runner.start()
    const engine = runner.engine
    expect(engine).not.toBeNull()
    await engine?.core.commit(engine.core.addSpace('s-team', '/Spaces/Team', 'write'))
    flushSync()
    expect(seen.at(-1)).toBe('s-team')
    await engine?.core.commit(engine.core.forgetSpace('s-team'))
    flushSync()
    expect(seen.at(-1)).toBeNull()
  } finally {
    stop()
    await runner.stop()
    Object.assign(account, { user: null })
  }
})
