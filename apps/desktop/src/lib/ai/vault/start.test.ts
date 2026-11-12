import { expect, test, vi } from 'vitest'

const opened: (() => void)[] = []

vi.mock('../../sync-client/src/hub.svelte', () => ({
  hub: {
    on: () => () => undefined,
    opened: (run: () => void) => {
      opened.push(run)
      return () => undefined
    },
  },
}))

await import('../store.svelte')
const { startVault, vault } = await import('./start.svelte')

test('a hub open again reads the vault again', () => {
  const refresh = vi.spyOn(vault, 'refresh').mockResolvedValue()
  startVault()
  refresh.mockClear()

  for (const run of opened) run()

  expect(refresh).toHaveBeenCalledOnce()
})
