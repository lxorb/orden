import { beforeEach, expect, test, vi } from 'vitest'

interface Held {
  id: string
  kind: string
  name?: string
  model?: string
}
const accounts: Held[] = []
const secrets = new Map<string, string>()
const GOOD = 'sk-good'
let made = 0
vi.mock('../../ai-providers/src/api', () => ({
  ai: {
    get accounts() {
      return accounts
    },
    add: (kind: string) => {
      const one = { id: `${kind}-${++made}`, kind }
      accounts.push(one)
      return one
    },
    update: (id: string, change: Partial<Held>) => {
      const one = accounts.find((held) => held.id === id)
      if (one) Object.assign(one, change)
    },
    remove: (id: string) => {
      const at = accounts.findIndex((held) => held.id === id)
      if (at !== -1) accounts.splice(at, 1)
    },
    written: () => Promise.resolve(),
  },
  readSecret: (id: string) => Promise.resolve(secrets.get(id) ?? null),
  writeKey: (id: string, key: string) => Promise.resolve(void secrets.set(id, key)),
  forgetKey: (id: string) => Promise.resolve(void secrets.delete(id)),
  listModels: (account: Held) =>
    secrets.get(account.id) === GOOD ? Promise.resolve([{ id: 'm' }]) : Promise.reject(new Error('401 bad key')),
  firstModel: () => 'm',
}))
const { connectCompatible, connectKey } = await import('./connect')
beforeEach(() => {
  accounts.length = 0
  secrets.clear()
})
const openRouter = { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyed: true }
test('a wrong key typed for a keyed provider leaves no account behind, and the right one leaves one', async () => {
  expect(await connectCompatible(openRouter as never, 'sk-wrong')).not.toBeNull()
  expect(await connectCompatible(openRouter as never, 'sk-wrong-again')).not.toBeNull()
  expect(await connectCompatible(openRouter as never, GOOD)).toBeNull()
  expect(accounts.map((one) => [one.kind, one.name, one.model])).toEqual([['compatible', 'OpenRouter', 'm']])
  expect([...secrets.values()]).toEqual([GOOD])
})
test('a wrong key typed over an account that already works keeps the key it had', async () => {
  accounts.push({ id: 'anthropic-held', kind: 'anthropic', model: 'm' })
  secrets.set('anthropic-held', GOOD)
  expect(await connectKey('anthropic', 'sk-wrong')).not.toBeNull()
  expect(secrets.get('anthropic-held')).toBe(GOOD)
  expect(accounts).toHaveLength(1)
})
test('a wrong key for a provider with no account yet leaves neither an account nor a key', async () => {
  expect(await connectKey('openai', 'sk-wrong')).not.toBeNull()
  expect(accounts).toEqual([])
  expect(secrets.size).toBe(0)
})
