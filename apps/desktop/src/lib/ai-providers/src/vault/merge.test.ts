import { describe, expect, test } from 'vitest'
import { activated, added, type Accounts, NONE, removed, updated, used } from '../accounts'
import { baseOf, type Contents, merged, type Side } from './merge'

const side = (contents: Contents): Side => ({ contents, prints: { ...contents.keys } })

const two: Accounts = added(added(NONE, 'anthropic').state, 'anthropic').state
const start: Contents = { accounts: two, keys: { anthropic: 'sk-1' }, seen: {} }
const base = baseOf(start, { ...start.keys })

describe('two devices’ changes met', () => {
  test('a key typed on one and a switch on the other both stay', () => {
    const here = side({ ...start, keys: { ...start.keys, 'anthropic-2': 'sk-2' } })
    const there = side({ ...start, accounts: activated(two, 'anthropic-2') })
    const met = merged(base, here, there)
    expect(met.keys).toEqual({ anthropic: 'sk-1', 'anthropic-2': 'sk-2' })
    expect(met.accounts.active.claude).toBe('anthropic-2')
  })

  test('an account removed on one stays removed, with its key', () => {
    const here = side(start)
    const there = side({ accounts: removed(two, 'anthropic'), keys: {}, seen: {} })
    const met = merged(base, here, there)
    expect(met.accounts.accounts.map((one) => one.id)).toEqual(['anthropic-2'])
    expect(met.keys).toEqual({})
  })

  test('a change on both sides goes to this device’s', () => {
    const here = side({ ...start, accounts: updated(two, 'anthropic', { name: 'Mine' }) })
    const there = side({ ...start, accounts: updated(two, 'anthropic', { name: 'Theirs' }) })
    expect(merged(base, here, there).accounts.accounts[0]?.name).toBe('Mine')
  })

  test('what only the other changed comes in', () => {
    const there = side({
      ...start,
      keys: { anthropic: 'sk-new' },
      seen: { anthropic: 'reader@example.com' },
    })
    const met = merged(base, side(start), there)
    expect(met.keys.anthropic).toBe('sk-new')
    expect(met.seen.anthropic).toBe('reader@example.com')
  })

  test('with nothing agreed yet, both sides’ accounts are kept and the other’s win', () => {
    const here = side({
      accounts: added(NONE, 'openai').state,
      keys: { openai: 'sk-here' },
      seen: {},
    })
    const met = merged(null, here, side(start))
    expect(met.accounts.accounts.map((one) => one.id)).toEqual([
      'anthropic',
      'anthropic-2',
      'openai',
    ])
    expect(met.keys).toEqual({ anthropic: 'sk-1', openai: 'sk-here' })
  })

  test('a different account under the same id on each side keeps both, with their keys', () => {
    const ollama = updated(added(NONE, 'compatible').state, 'compatible-1', {
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
    })
    const router = updated(added(NONE, 'compatible').state, 'compatible-1', {
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    })
    const here = side({
      accounts: used(ollama, 'chat', 'compatible-1'),
      keys: { 'compatible-1': 'sk-a' },
      seen: {},
    })
    const there = side({ accounts: router, keys: { 'compatible-1': 'sk-k' }, seen: {} })
    const met = merged(null, here, there)
    expect(met.accounts.accounts.map((one) => [one.id, one.name])).toEqual([
      ['compatible-1', 'OpenRouter'],
      ['compatible-2', 'Ollama'],
    ])
    expect(met.keys).toEqual({ 'compatible-1': 'sk-k', 'compatible-2': 'sk-a' })
    expect(met.accounts.uses).toEqual({ chat: 'compatible-2' })
  })

  test('a second account added on each side while apart keeps both', () => {
    const here = side({ ...start, keys: { ...start.keys, 'anthropic-2': 'sk-here' } })
    const there = side({ ...start, keys: { ...start.keys, 'anthropic-2': 'sk-there' } })
    const one = added(NONE, 'anthropic').state
    const met = merged(baseOf({ ...start, accounts: one }, { ...start.keys }), here, there)
    expect(met.accounts.accounts.map((each) => each.id)).toEqual([
      'anthropic',
      'anthropic-2',
      'anthropic-3',
    ])
    expect(met.keys).toEqual({
      anthropic: 'sk-1',
      'anthropic-2': 'sk-there',
      'anthropic-3': 'sk-here',
    })
  })

  test('the same account on both sides with nothing agreed stays one', () => {
    const met = merged(null, side(start), side(start))
    expect(met.accounts.accounts.map((one) => one.id)).toEqual(['anthropic', 'anthropic-2'])
    expect(met.keys).toEqual({ anthropic: 'sk-1' })
  })
})
