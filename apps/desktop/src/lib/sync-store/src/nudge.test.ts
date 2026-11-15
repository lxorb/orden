import { afterEach, describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})

const { sync } = await import('./sync.svelte')

const listening = { addEventListener: () => undefined, removeEventListener: () => undefined }
vi.stubGlobal('document', { ...listening, hidden: false })
vi.stubGlobal('window', listening)

afterEach(() => {
  vi.useRealTimers()
})

function passes() {
  const seen = { started: 0, finish: () => undefined as unknown }
  let busy = false
  sync.run = () => {
    if (busy) return Promise.resolve(false)
    busy = true
    seen.started += 1
    return new Promise<boolean>((done) => {
      seen.finish = () => {
        busy = false
        done(false)
      }
    })
  }
  return seen
}

describe('a nudge', () => {
  test('while a pass runs brings the next pass seconds after it, not at the next poll', async () => {
    vi.useFakeTimers()
    const seen = passes()
    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.started).toBe(1)

    sync.nudge()
    await vi.advanceTimersByTimeAsync(100)
    seen.finish()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(seen.started).toBe(2)
    seen.finish()
  })
})
