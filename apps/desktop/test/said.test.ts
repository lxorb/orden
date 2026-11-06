import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { said } from '../src/lib/said.svelte'

beforeEach(() => {
  vi.useFakeTimers()
  vi.runAllTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

describe('the live region', () => {
  test('carries what it was told, and empties itself after a while', () => {
    said.say('Syncing')
    expect(said.words).toBe('Syncing')

    vi.advanceTimersByTime(4000)
    expect(said.words).toBe('')
  })

  test('says the same thing twice, which means emptying first', async () => {
    said.say('Sync failed')
    expect(said.words).toBe('Sync failed')

    said.say('Sync failed')
    expect(said.words).toBe('')
    await Promise.resolve()
    expect(said.words).toBe('Sync failed')
  })

  test('has nothing to say about nothing', () => {
    said.say('Saved')
    said.say('   ')
    expect(said.words).toBe('Saved')
  })

  test('never puts an older sentence back over a newer one', async () => {
    said.say('Saving')
    said.say('Saving')
    said.say('Saved')

    await Promise.resolve()
    expect(said.words).toBe('Saved')
  })

  test('decides by what it last wrote, not by what the region holds', async () => {
    said.say('Syncing')
    expect(said.words).toBe('Syncing')

    said.words = 'something else entirely'

    said.say('Syncing')
    expect(said.words).toBe('')
    await Promise.resolve()
    expect(said.words).toBe('Syncing')
  })
})
