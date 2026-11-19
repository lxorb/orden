import { describe, expect, expectTypeOf, test, vi } from 'vitest'
import { ai, firstModel, isLocal, KIND_NAMES, localCli, MODES, modeIn, modeOfGrant } from '../src/api'
import { noMoreThan, offeredKinds, signOut, sseJson, sseLines, talkable, type Thread, vault } from '../src/api'

const kept = vi.hoisted(() => {
  const held = new Map<string, string>()
  const storage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  return held
})

describe('the module stands on its own', () => {
  test('signing in to a local program answers no while no module lends a terminal', async () => {
    const { signIn } = await localCli()
    await expect(signIn('claude-code', '/usr/bin/claude')).resolves.toBe(false)
  })
})
describe('what a mode allows', () => {
  test('a mode asked for is never more than the one held', () => {
    expect(noMoreThan('full', 'auto')).toBeNull()
    expect(noMoreThan('auto', 'approve')).toBeNull()
    expect(noMoreThan('plan', 'approve')).toBeNull()
    expect(noMoreThan('approve', 'auto')).toBe('approve')
    for (const asked of MODES) expect(noMoreThan(asked, 'full')).toBe(asked)
  })
  test('a grant that asks for confirmation acts only on approval', () => {
    expect(modeOfGrant('confirm')).toBe('approve')
    expect(modeOfGrant('unsupervised')).toBe('auto')
    expect(modeOfGrant('autonomous')).toBe('full')
  })
  test('the older words for a mode still read, and nothing else does', () => {
    expect(modeIn('ask')).toBe('approve')
    expect(modeIn('agent')).toBe('full')
    expect(modeIn('everything')).toBeNull()
  })
})
describe('the providers', () => {
  test('every kind has a name, and the local ones are offered only on a desktop', () => {
    for (const kind of offeredKinds(true, true)) expect(KIND_NAMES[kind]).toBeTruthy()
    expect(offeredKinds(false, true).some((kind) => isLocal(kind))).toBe(false)
  })
  test('models that cannot chat are left out, and the newest one is first', () => {
    expect(talkable('openai', ['gpt-4.1', 'whisper-1', 'text-embedding-3-small'])).toEqual(['gpt-4.1'])
    expect(firstModel('anthropic', ['claude-sonnet-4-5', 'claude-sonnet-4'])).toBe('claude-sonnet-4-5')
  })
  test('a stream is read line by line, with a part line kept for the next chunk', () => {
    const first = sseLines('', 'data: {"a":1}\ndata: {"b"')
    expect(first.payloads).toEqual(['{"a":1}'])
    const second = sseLines(first.rest, ':2}\n')
    expect(second.payloads.map((one) => sseJson(one))).toEqual([{ b: 2 }])
    expect(sseJson('[DONE]')).toBeNull()
  })
})
describe('a thread', () => {
  test('may name the only tools it can list and call, and an empty list names none', () => {
    expectTypeOf<Thread['only']>().toEqualTypeOf<string[] | undefined>()
    const none: Pick<Thread, 'only'> = { only: [] }
    expect(none.only).toEqual([])
  })
})
describe('an Orden account leaving the device', () => {
  test('takes the AI accounts of its vault and their keys with it, and leaves the ones only ever here', async () => {
    const theirs = ai.add('anthropic')
    const mine = ai.add('openai')
    await ai.written()
    const accounts = { accounts: [theirs], active: {}, defaultVendor: '', uses: {} }
    kept.set('orden:ai-vault-account', 'u1')
    kept.set('orden:ai-vault-base:u1', JSON.stringify({ accounts, keys: {}, seen: {} }))
    vault.seen = { [theirs.id]: 'a@example.com' }
    await signOut()
    await vi.waitFor(() => expect(ai.accounts.map((one) => one.id)).toEqual([mine.id]))
    expect(vault.seen).toEqual({})
    expect(kept.has('orden:ai-vault-base:u1')).toBe(false)
  })
})
