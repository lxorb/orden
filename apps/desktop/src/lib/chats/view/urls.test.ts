import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Chats } from '../api'

/** A file whose fetch failed once is asked for again (B545). The store answers null for a
 *  dropped connection or a 5xx, and the row kept that null until the app restarted: a
 *  picture opened while the laptop was waking stayed blank for the whole session. */

const { useStore } = await import('./source.svelte')
const { fileUrl } = await import('./urls.svelte')

// After the imports: the store graph reads a whole window when there is one.
const online = new EventTarget()
vi.stubGlobal('window', online)

const ask = vi.fn<(chat: string, hash: string) => Promise<string | null>>()

beforeEach(() => {
  vi.useFakeTimers()
  ask.mockReset()
  useStore({ fileUrl: ask } as unknown as Chats)
})

afterEach(() => {
  vi.useRealTimers()
})

test('a file whose fetch failed is asked again after a wait, and kept once it lands', async () => {
  ask.mockResolvedValueOnce(null).mockResolvedValue('blob:ok')

  expect(fileUrl('c1', 'h1')).toBeNull()
  await vi.advanceTimersByTimeAsync(0)
  expect(fileUrl('c1', 'h1')).toBeNull()
  expect(ask).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(60_000)
  expect(fileUrl('c1', 'h1')).toBe('blob:ok')
  expect(ask).toHaveBeenCalledTimes(2)

  await vi.advanceTimersByTimeAsync(600_000)
  expect(fileUrl('c1', 'h1')).toBe('blob:ok')
  expect(ask).toHaveBeenCalledTimes(2)
})

test('a rejected fetch is asked again too', async () => {
  ask.mockRejectedValueOnce(new Error('offline')).mockResolvedValue('blob:ok')

  expect(fileUrl('c1', 'h2')).toBeNull()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(fileUrl('c1', 'h2')).toBe('blob:ok')
})

test('the waits grow while the file stays out of reach', async () => {
  ask.mockResolvedValue(null)

  fileUrl('c1', 'h3')
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  // 2 s, 4 s, 8 s, ... capped: far fewer asks than one a second
  expect(ask.mock.calls.length).toBeGreaterThan(2)
  expect(ask.mock.calls.length).toBeLessThan(20)
})

test('coming back online asks at once', async () => {
  ask.mockResolvedValueOnce(null).mockResolvedValue('blob:ok')

  fileUrl('c1', 'h4')
  await vi.advanceTimersByTimeAsync(0)
  online.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(0)
  expect(fileUrl('c1', 'h4')).toBe('blob:ok')
})
