import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Held {
  id: string
  kind: string
  model: string
  name?: string
  baseUrl?: string
}
const held: {
  accounts: Held[]
  keys: Map<string, string>
  refusing: boolean
  standing: { state: string; program?: string }
  starts: boolean
} = { accounts: [], keys: new Map(), refusing: false, standing: { state: 'missing' }, starts: true }
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  isDesktop: true,
  openExternal: () => Promise.resolve(),
}))
vi.mock('../../ai-providers/src/api', () => {
  let made = 0
  const ai = {
    get accounts() {
      return held.accounts
    },
    add(kind: string) {
      const account = { id: `a${++made}`, kind, model: '' }
      held.accounts = [...held.accounts, account]
      return account
    },
    update(id: string, change: Partial<Held>) {
      held.accounts = held.accounts.map((one) => (one.id === id ? { ...one, ...change } : one))
    },
    remove(id: string) {
      held.accounts = held.accounts.filter((one) => one.id !== id)
    },
    written: () => Promise.resolve(),
  }
  return {
    ai,
    readSecret: (id: string) => Promise.resolve(held.keys.get(id) ?? null),
    writeKey: (id: string, key: string) => {
      held.keys.set(id, key)
      return Promise.resolve()
    },
    forgetKey: (id: string) => {
      held.keys.delete(id)
      return Promise.resolve()
    },
    listModels: () => (held.refusing ? Promise.reject(new Error('That key was refused.')) : Promise.resolve(['m1'])),
    firstModel: (_kind: string, models: string[]) => models[0] ?? '',
    localCli: () =>
      Promise.resolve({
        plans: { check: () => Promise.resolve(held.standing), watch: () => undefined },
        signIn: () => Promise.resolve(held.starts),
      }),
  }
})
const { connectCompatible, connectKey, signInWith } = await import('./connect')
const { MORE_AI } = await import('./catalog')
const openRouter = MORE_AI.find((one) => one.id === 'openrouter')
if (!openRouter) throw new Error('OpenRouter is missing from the catalog')
beforeEach(() => {
  held.accounts = []
  held.keys = new Map()
  held.refusing = false
  held.standing = { state: 'missing' }
  held.starts = true
})
describe('connecting an AI during setup', () => {
  test('a refused key leaves no extra provider behind, however often it is tried', async () => {
    held.refusing = true
    expect(await connectCompatible(openRouter, 'sk-or-wrong-key-123456')).toBe('That key was refused.')
    expect(await connectCompatible(openRouter, 'sk-or-wrong-key-654321')).toBe('That key was refused.')
    expect(held.accounts).toEqual([])
    expect([...held.keys.keys()]).toEqual([])
    held.refusing = false
    expect(await connectCompatible(openRouter, 'sk-or-right-key-123456')).toBeNull()
    expect(held.accounts.map((one) => one.name)).toEqual(['OpenRouter'])
  })
  test('a refused key for a new account takes the account and its key away again', async () => {
    held.refusing = true
    expect(await connectKey('anthropic', 'sk-ant-wrong-key-123456')).toBe('That key was refused.')
    expect(held.accounts).toEqual([])
    expect([...held.keys.keys()]).toEqual([])
  })
  test('a refused key for an account that was already there keeps that account', async () => {
    held.accounts = [{ id: 'mine', kind: 'anthropic', model: 'claude' }]
    held.refusing = true
    expect(await connectKey('anthropic', 'sk-ant-wrong-key-123456')).toBe('That key was refused.')
    expect(held.accounts.map((one) => one.id)).toEqual(['mine'])
  })
  test('a sign-in to a program that is not installed leaves no account behind', async () => {
    expect(await signInWith('gemini')).toEqual({ state: 'failed', said: 'Not installed' })
    expect(held.accounts).toEqual([])
  })
  test('a sign-in to a program not installed keeps an account that was already there', async () => {
    held.accounts = [{ id: 'mine', kind: 'gemini-cli', model: 'gemini' }]
    expect(await signInWith('gemini')).toEqual({ state: 'failed', said: 'Not installed' })
    expect(held.accounts.map((one) => one.id)).toEqual(['mine'])
  })
  test('a sign-in whose terminal never starts says so and leaves no account behind', async () => {
    held.standing = { state: 'out', program: '/usr/bin/gemini' }
    held.starts = false
    expect(await signInWith('gemini')).toEqual({ state: 'failed', said: 'Could not sign in.' })
    expect(held.accounts).toEqual([])
    held.starts = true
    expect(await signInWith('gemini')).toMatchObject({ state: 'waiting' })
    expect(held.accounts.map((one) => one.kind)).toEqual(['gemini-cli'])
  })
})
