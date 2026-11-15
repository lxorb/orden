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

const keys = vi.hoisted(() => ({ refuse: false }))
vi.mock('../keys', async (original) => ({
  ...(await original<typeof import('../keys')>()),
  writeKey: async () => {
    if (keys.refuse) throw new Error('the keychain said no')
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

test('nothing is kept as moved when the keys of a merge could not be written', async () => {
  const none = {
    accounts: { accounts: [], active: {}, defaultVendor: '', uses: {} },
    keys: {},
    seen: {},
  }
  const adopt = vi.spyOn(ai, 'adopt').mockImplementation(() => undefined)
  keys.refuse = true

  await expect(
    world.apply({ ...none, keys: { 'openai-2': 'sk-moved' } }, none, { openai: 'openai-2' }),
  ).rejects.toThrow('the keychain said no')

  keys.refuse = false
  expect(movedSince('openai', 0)).toBe('openai')
  expect(adopt).not.toHaveBeenCalled()
})

test('a move is kept with the account it moved, so the same move said by another window is kept once', async () => {
  const mine = {
    accounts: {
      accounts: [{ id: 'openai', kind: 'openai' as const, name: 'OpenAI', model: '' }],
      active: {},
      defaultVendor: '',
      uses: {},
    },
    keys: {},
    seen: {},
  }
  vi.spyOn(ai, 'adopt').mockImplementation(() => undefined)

  await world.apply(mine, mine, { openai: 'openai-9' })
  await world.apply(mine, mine, { openai: 'openai-9' })

  const { movesAfter } = await import('../moves')
  expect(movesAfter(0).filter((one) => one.to === 'openai-9')).toEqual([
    expect.objectContaining({ from: 'openai', to: 'openai-9', who: 'openai||' }),
  ])
})
