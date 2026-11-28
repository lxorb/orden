import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test, vi } from 'vitest'

interface Who {
  accountToken: string | null
  user: { id: string } | null
}
const state = vi.hoisted(() => {
  const account: Who = { accountToken: 't', user: { id: 'u' } }
  const puts: unknown[] = []
  return { account, puts, put: (..._args: unknown[]): Promise<unknown> => new Promise(() => undefined) }
})
vi.mock('../../accounts/src/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }
  return {
    account: state.account,
    api: {
      putBlob: (...args: unknown[]) => {
        state.puts.push(args[1])
        return state.put(...args)
      },
    },
    ApiError,
    usage: { refresh: () => Promise.resolve() },
  }
})
const bytes = (fill: number) => new Uint8Array([fill, fill, fill]).buffer
const owed = (hash: string, fill = 1) => ({ hash, type: 'image/png', bytes: bytes(fill), whose: 'u' })
const fresh = async () => {
  vi.resetModules()
  return {
    owing: await import('./pictures-owed'),
    platform: await import('../../platform/src/images'),
    api: await import('../../accounts/src/api'),
  }
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))
const putsOf = (hash: string) => state.puts.filter((one) => one === hash).length
afterEach(() => {
  vi.useRealTimers()
  state.put = () => new Promise(() => undefined)
  state.puts = []
  state.account.accountToken = 't'
  state.account.user = { id: 'u' }
})
describe('a picture inserted while signed in', () => {
  test('is drawn from this device while its upload has not answered', async () => {
    const { owing, platform } = await fresh()
    const hash = 'a1'.repeat(32)
    const kept = owing.owe(owed(hash))
    expect(platform.imageUrl(`https://orden.so/i/${hash}.png`)).toMatch(/^blob:/)
    await kept
    await settled()
    expect(putsOf(hash)).toBe(1)
    expect(platform.pictureNote(platform.imageUrl(`https://orden.so/i/${hash}.png`))).toBeNull()
  })
  test('is tried again after a failed upload, with a quiet note on it until it lands', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { owing, platform } = await fresh()
    const hash = 'b2'.repeat(32)
    const address = `https://orden.so/i/${hash}.png`
    state.put = () => Promise.reject(new Error('Failed to fetch'))
    await owing.owe(owed(hash))
    await vi.advanceTimersByTimeAsync(0)
    const shown = platform.imageUrl(address)
    expect(shown).toMatch(/^blob:/)
    expect(platform.pictureNote(shown)).toBe(owing.NOT_YET)
    state.put = () => Promise.resolve({ hash, stored: true })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(putsOf(hash)).toBe(2)
    expect(platform.pictureNote(shown)).toBeNull()
    expect(platform.imageUrl(address)).toBe(shown)
    const again = await fresh()
    await again.owing.carryOwed()
    expect(again.platform.heldPicture(address)).toBeNull()
  })
  test('says the storage is full when the account turns it down for space', async () => {
    const { owing, platform, api } = await fresh()
    const hash = 'c3'.repeat(32)
    state.put = () => Promise.reject(new api.ApiError(507, 'out of space'))
    await owing.owe(owed(hash))
    await settled()
    expect(platform.pictureNote(platform.imageUrl(`/i/${hash}.png`))).toBe(owing.FULL)
  })
  test('is still drawn and still owed after the app starts again before it was uploaded', async () => {
    const first = await fresh()
    const hash = 'd4'.repeat(32)
    await first.owing.owe(owed(hash, 7))
    await settled()
    const puts = putsOf(hash)
    const next = await fresh()
    let moved = 0
    next.platform.onPicturesMoved(() => moved++)
    expect(next.platform.heldPicture(`https://orden.so/i/${hash}.png`)).toBeNull()
    await next.owing.carryOwed()
    expect(next.platform.heldPicture(`https://orden.so/i/${hash}.png`)).toMatch(/^blob:/)
    expect(moved).toBeGreaterThan(0)
    expect(putsOf(hash)).toBeGreaterThan(puts)
  })
  test('waits for its own account, not whoever signs in next', async () => {
    const { owing } = await fresh()
    state.account.user = { id: 'someone else' }
    await owing.owe(owed('e5'.repeat(32)))
    await settled()
    expect(putsOf('e5'.repeat(32))).toBe(0)
  })
})
