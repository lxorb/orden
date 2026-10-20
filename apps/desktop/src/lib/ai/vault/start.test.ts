/** When the vault reads again. A device asking for the key hears that it was answered
 *  through its hub, and a word said while its hub was not open yet - the phone's own
 *  hub still connecting after its sign-in, when the laptop answers at once - is never
 *  said again. So the hub being spoken to afresh is a read of its own; see `opened` in
 *  hub.svelte.ts. */

import { expect, test, vi } from 'vitest'

const opened: (() => void)[] = []

vi.mock('../../sync2/hub.svelte', () => ({
  hub: {
    on: () => () => undefined,
    opened: (run: () => void) => {
      opened.push(run)
      return () => undefined
    },
  },
}))

// The AI store starts the vault as it arrives, as it does in the app.
await import('../store.svelte')
const { startVault, vault } = await import('./start.svelte')

test('a hub open again reads the vault again', () => {
  const refresh = vi.spyOn(vault, 'refresh').mockResolvedValue()
  startVault()
  refresh.mockClear()

  for (const run of opened) run()

  expect(refresh).toHaveBeenCalledOnce()
})
