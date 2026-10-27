import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Who } from '@nib/chats'
import type { Chats } from '../api'
import { computed, root, watch } from '../../../../test/effects/runes.svelte'

/** A file whose fetch failed is asked again while a row still draws it (B545). The store
 *  answers null for a dropped connection or a 5xx, and the row kept that null until the app
 *  restarted. A retry belongs to the rows that draw the file and to the session that asked:
 *  a closed chat, a row gone, or another account asks nothing more. */

const { useStore } = await import('./source.svelte')
const { fileUrl } = await import('./urls.svelte')

type Ask = (chat: string, hash: string) => Promise<string | null>

function storeOf(me: Who | null, ask: Ask): Chats {
  return { me, fileUrl: ask } as unknown as Chats
}

/** A row drawing the file, as a template reads it. Answers what it shows and how to close. */
function row(chat: string, hash: string): { shown: () => string | null; close: () => void } {
  let shown: string | null = null
  const close = root(() => {
    const url = computed(() => fileUrl(chat, hash))
    watch(() => {
      shown = url()
    })
  })
  flushSync()
  return { shown: () => shown, close }
}

async function wait(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('a file whose fetch failed is asked again while its row draws it, and kept once it lands', async () => {
  const ask = vi.fn<Ask>().mockResolvedValueOnce(null).mockResolvedValue('blob:ok')
  useStore(storeOf('user:a', ask))
  const view = row('c1', 'h1')

  await wait(0)
  expect(view.shown()).toBeNull()
  await wait(60_000)
  expect(view.shown()).toBe('blob:ok')
  expect(ask).toHaveBeenCalledTimes(2)

  await wait(30 * 60_000)
  expect(ask).toHaveBeenCalledTimes(2)
  view.close()
})

test('a rejected fetch is asked again too', async () => {
  const ask = vi.fn<Ask>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('blob:ok')
  useStore(storeOf('user:a', ask))
  const view = row('c1', 'h2')

  await wait(60_000)
  expect(view.shown()).toBe('blob:ok')
  view.close()
})

test('a file no row draws any more is not asked again', async () => {
  const ask = vi.fn<Ask>().mockResolvedValue(null)
  useStore(storeOf('user:a', ask))
  const view = row('c1', 'h3')
  await wait(0)
  view.close()

  await wait(60 * 60_000)
  expect(ask).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

test('a file that never lands is asked with growing waits, then every five minutes while drawn', async () => {
  const ask = vi.fn<Ask>().mockResolvedValue(null)
  useStore(storeOf('user:a', ask))
  const view = row('c1', 'h4')

  await wait(10 * 60_000)
  const early = ask.mock.calls.length
  expect(early).toBeGreaterThan(2)
  expect(early).toBeLessThan(12)
  await wait(60 * 60_000)
  // twelve an hour at the longest wait, give or take
  expect(ask.mock.calls.length - early).toBeGreaterThanOrEqual(11)
  expect(ask.mock.calls.length - early).toBeLessThanOrEqual(13)
  view.close()
})

test('a server down for six minutes: the picture comes back, and a reopened chat draws it', async () => {
  let up = false
  const ask = vi.fn<Ask>(() => Promise.resolve(up ? 'blob:ok' : null))
  useStore(storeOf('user:a', ask))
  const first = row('c1', 'h9')
  await wait(6 * 60_000)
  up = true
  await wait(6 * 60_000)
  expect(first.shown()).toBe('blob:ok')
  first.close()
  const again = row('c1', 'h9')
  expect(again.shown()).toBe('blob:ok')
  again.close()
})

test('a chat closed during an outage and opened after it asks again', async () => {
  let up = false
  const ask = vi.fn<Ask>(() => Promise.resolve(up ? 'blob:ok' : null))
  useStore(storeOf('user:a', ask))
  const first = row('c1', 'h10')
  await wait(30 * 60_000)
  first.close()
  up = true
  await wait(60 * 60_000)
  const again = row('c1', 'h10')
  await wait(0)
  expect(again.shown()).toBe('blob:ok')
  again.close()
})

test('online before the network works does not end the retries', async () => {
  let up = false
  const ask = vi.fn<Ask>(() => Promise.resolve(up ? 'blob:ok' : null))
  useStore(storeOf('user:a', ask))
  const view = row('c1', 'h11')
  await wait(30 * 60_000)
  window.dispatchEvent(new Event('online'))
  await wait(0)
  up = true
  // the wait starts over after online: well under the longest wait
  await wait(10_000)
  expect(view.shown()).toBe('blob:ok')
  view.close()
})

test('coming back online asks at once', async () => {
  const ask = vi.fn<Ask>().mockResolvedValueOnce(null).mockResolvedValue('blob:ok')
  useStore(storeOf('user:a', ask))
  const view = row('c1', 'h5')

  await wait(0)
  window.dispatchEvent(new Event('online'))
  await wait(0)
  expect(view.shown()).toBe('blob:ok')
  view.close()
})

test('online while an ask is on its way starts no second chain (review of #990, M1)', async () => {
  // a file the reader may no longer see: every answer is null, and each takes a second
  let open = 0
  let most = 0
  const ask = vi.fn<Ask>(() => {
    most = Math.max(most, ++open)
    return new Promise<string | null>((resolve) =>
      setTimeout(() => {
        open--
        resolve(null)
      }, 1000),
    )
  })
  useStore(storeOf('user:a', ask))
  const view = row('c1', 'h6')

  let flaps = 0
  for (let second = 0; second < 30 * 60; second++) {
    // the Wi-Fi flaps five times, each while an ask is out
    if (flaps < 5 && open > 0) {
      window.dispatchEvent(new Event('online'))
      flaps++
    }
    await wait(1000)
    // the answer's own timer, and at most one wait
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2)
  }
  expect(flaps).toBe(5)
  expect(most).toBe(1)
  // one chain: the backoff to the longest wait, and one ask per flap
  expect(ask.mock.calls.length).toBeLessThanOrEqual(8 + 5 + 7)
  view.close()
})

test('another account starts from nothing, and the last one asks no more', async () => {
  const before = vi.fn<Ask>().mockResolvedValue('blob:a')
  const failing = vi.fn<Ask>().mockResolvedValue(null)
  useStore(
    storeOf('user:a', (chat, hash) => (hash === 'h7' ? before(chat, hash) : failing(chat, hash))),
  )
  const seen = row('c1', 'h7')
  const missing = row('c1', 'h8')
  await wait(0)
  expect(seen.shown()).toBe('blob:a')

  const after = vi.fn<Ask>().mockResolvedValue('blob:b')
  useStore(storeOf('user:b', after))
  flushSync()
  expect(seen.shown()).toBeNull()
  await wait(0)
  expect(seen.shown()).toBe('blob:b')

  await wait(60 * 60_000)
  expect(before).toHaveBeenCalledTimes(1)
  expect(failing).toHaveBeenCalledTimes(1)
  seen.close()
  missing.close()
})
