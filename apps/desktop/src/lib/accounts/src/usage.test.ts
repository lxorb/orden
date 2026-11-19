import { describe, expect, test, vi } from 'vitest'

const server = vi.hoisted(() => ({
  held: [] as (() => void)[],
  account: { accountToken: 'first' },
}))
vi.mock('./account.svelte', () => ({ account: server.account }))
vi.mock('./client', () => ({
  api: {
    usage: () =>
      new Promise<{ used: number; limit: number }>((done) => server.held.push(() => done({ used: 95, limit: 100 }))),
  },
}))
const { NEARLY_FULL, readableSize, usage } = await import('./usage.svelte')

describe('showing a size', () => {
  test('leaves small things in bytes', () => {
    expect(readableSize(0)).toBe('0 B')
    expect(readableSize(999)).toBe('999 B')
  })
  test('moves up a unit at a time', () => {
    expect(readableSize(1024)).toBe('1.0 KB')
    expect(readableSize(1024 * 1024)).toBe('1.0 MB')
    expect(readableSize(1024 * 1024 * 1024)).toBe('1.0 GB')
  })
  test('drops the decimal once the number is big enough not to need it', () => {
    expect(readableSize(1024 * 15)).toBe('15 KB')
    expect(readableSize(1024 * 1024 * 250)).toBe('250 MB')
  })
  test('stops at gigabytes, which is as large as an account gets', () => {
    expect(readableSize(1024 ** 4)).toBe('1024 GB')
  })
})
describe('the warning threshold', () => {
  test('is nine tenths', () => {
    expect(NEARLY_FULL).toBe(0.9)
  })
  test('leaves a full gigabyte account quiet until it is nearly used up', () => {
    const limit = 1024 ** 3
    expect((limit * 0.89) / limit >= NEARLY_FULL).toBe(false)
    expect((limit * 0.91) / limit >= NEARLY_FULL).toBe(true)
  })
})
describe('the numbers of one account', () => {
  test('are dropped when they arrive after another account signed in', async () => {
    const asking = usage.refresh()
    server.account.accountToken = 'second'
    usage.reset()
    for (const one of server.held) one()
    await asking
    expect(usage.used).toBe(0)
    expect(usage.limit).toBe(0)
    expect(usage.warning).toBe(false)
  })
  test('are kept when the same account is still there', async () => {
    server.held = []
    const asking = usage.refresh()
    for (const one of server.held) one()
    await asking
    expect(usage.used).toBe(95)
    expect(usage.limit).toBe(100)
  })
})
