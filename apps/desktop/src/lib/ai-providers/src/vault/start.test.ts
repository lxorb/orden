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

const carried = vi.hoisted(() => ({
  calls: [] as { command: string; args: unknown; moved: string }[],
  now: (): string => '',
}))
vi.mock('../../../platform/src/api', async (original) => {
  const platform = await original<typeof import('../../../platform/src/api')>()
  return {
    ...platform,
    isDesktop: true,
    invoke: async (command: string, args: unknown) => {
      if (command !== 'ai_agent_moved') return platform.invoke(command, args as never)
      carried.calls.push({ command, args, moved: carried.now() })
      return true
    },
  }
})

const { ai } = await import('../store.svelte')
const { startVault, vault, world } = await import('./start.svelte')
const { movedSince } = await import('../moves')
carried.now = () => movedSince('anthropic', 0)

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

test('the agent rights of an account moved to a fresh id are carried to it before it moves', async () => {
  const none = {
    accounts: { accounts: [], active: {}, defaultVendor: '', uses: {} },
    keys: {},
    seen: {},
  }
  vi.spyOn(ai, 'adopt').mockImplementation(() => undefined)
  carried.calls.length = 0

  await world.apply(none, none, { anthropic: 'anthropic-2' })

  expect(carried.calls).toEqual([
    {
      command: 'ai_agent_moved',
      args: { from: 'anthropic', to: 'anthropic-2' },
      moved: 'anthropic',
    },
  ])
})
