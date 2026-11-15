import { expect, test, vi } from 'vitest'

const opened: (() => void)[] = []

vi.mock('../../../sync-client/src/api', async (original) => ({
  ...(await original<typeof import('../../../sync-client/src/api')>()),
  hub: {
    on: () => () => undefined,
    opened: (run: () => void) => {
      opened.push(run)
      return () => undefined
    },
  },
}))

const { ai } = await import('../store.svelte')
const { startVault, vault, world } = await import('./start.svelte')
const { movedSince } = await import('../moves')

test('a hub open again reads the vault again', async () => {
  const refresh = vi.spyOn(vault, 'refresh').mockResolvedValue()
  startVault()
  await vi.waitFor(() => expect(opened).not.toHaveLength(0))
  refresh.mockClear()

  for (const run of opened) run()

  expect(refresh).toHaveBeenCalledOnce()
})

test('what moved to a fresh id is kept as moved before the accounts are taken', async () => {
  const none = {
    accounts: { accounts: [], active: {}, defaultVendor: '', uses: {} },
    keys: {},
    seen: {},
  }
  const seen: string[] = []
  vi.spyOn(ai, 'adopt').mockImplementation(() => {
    seen.push(movedSince('compatible-1', 0))
  })

  await world.apply(none, none, { 'compatible-1': 'compatible-2' })

  expect(seen).toEqual(['compatible-2'])
})
