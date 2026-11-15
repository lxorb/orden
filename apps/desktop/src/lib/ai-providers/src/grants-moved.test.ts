import { expect, test, vi } from 'vitest'

const store = vi.hoisted(() => ({ grants: [] as Record<string, unknown>[] }))

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'agents_read') return store.grants.map((one) => ({ ...one }))
    if (command === 'agents_write') {
      store.grants = args.grants as Record<string, unknown>[]
      return store.grants
    }
    if (command === 'ai_agent_tools') {
      const agent = args.agent as { id: string; name: string }
      const id = `orden-${agent.id}`
      if (!store.grants.some((one) => one.id === id)) {
        store.grants.push(grant(id, `Orden ${agent.name}`, 'all', 'unsupervised'))
      }
      return { instructions: '', tools: [] }
    }
    throw new Error(`no ${command} here`)
  },
}))

function grant(id: string, client: string, spaces: unknown, mode: string) {
  return { id, name: client, client, scopes: ['notes.read'], spaces, mode, built_in: true }
}

const { carryGrants } = await import('./grants-moved')

const moved = { id: 'openai-2', kind: 'openai', name: 'OpenAI', model: 'gpt' } as const

test('the rights given to an account the vault moved go with it, and its old id starts afresh', async () => {
  store.grants = [
    grant('orden-openai', 'Orden OpenAI', ['work'], 'confirm'),
    grant('codex', 'Codex', 'all', 'confirm'),
  ]

  await carryGrants({ openai: 'openai-2' }, [moved])

  expect(store.grants.map((one) => one.id).sort()).toEqual(['codex', 'orden-openai-2'])
  expect(store.grants.find((one) => one.id === 'orden-openai-2')).toMatchObject({
    spaces: ['work'],
    mode: 'confirm',
  })
})

test('a rights kept from before the rename go along too', async () => {
  store.grants = [grant('nib-openai', 'Nib OpenAI', ['work'], 'confirm')]

  await carryGrants({ openai: 'openai-2' }, [moved])

  expect(store.grants).toHaveLength(1)
  expect(store.grants[0]).toMatchObject({ id: 'orden-openai-2', spaces: ['work'] })
})

test('an account never lent to an agent here mints nothing', async () => {
  store.grants = []

  await carryGrants({ openai: 'openai-2' }, [moved])

  expect(store.grants).toEqual([])
})
