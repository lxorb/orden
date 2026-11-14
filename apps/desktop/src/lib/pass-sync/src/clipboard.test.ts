import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Clipboard } from './clipboard'
import { copySecret, isPassSecret } from './clipboard'

function board(readable = true): Clipboard & { held: string; writes: string[] } {
  const one = {
    held: '',
    writes: [] as string[],
    read: () => (readable ? Promise.resolve(one.held) : Promise.reject(new Error('denied'))),
    write: (text: string) => {
      one.held = text
      one.writes.push(text)
      return Promise.resolve()
    },
  }
  return one
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a copied secret', () => {
  test('is cleared after the time chosen while the clipboard still holds it', async () => {
    const clipboard = board()
    await copySecret('s3cret', 15, clipboard)
    expect(clipboard.held).toBe('s3cret')
    await vi.advanceTimersByTimeAsync(14_000)
    expect(clipboard.held).toBe('s3cret')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(clipboard.held).toBe('')
  })

  test('is left alone when something else was copied since', async () => {
    const clipboard = board()
    await copySecret('s3cret', 15, clipboard)
    clipboard.held = 'a link'
    await vi.advanceTimersByTimeAsync(15_000)
    expect(clipboard.held).toBe('a link')
    expect(clipboard.writes).toEqual(['s3cret'])
  })

  test('is cleared when the clipboard cannot be read', async () => {
    const clipboard = board(false)
    await copySecret('s3cret', 60, clipboard)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(clipboard.writes).toEqual(['s3cret', ''])
  })

  test('is never cleared when the reader chose never', async () => {
    const clipboard = board()
    await copySecret('s3cret', 0, clipboard)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(clipboard.held).toBe('s3cret')
  })

  test('copied again starts its own clock, and the first one does nothing', async () => {
    const clipboard = board(false)
    await copySecret('first', 15, clipboard)
    await vi.advanceTimersByTimeAsync(10_000)
    await copySecret('second', 60, clipboard)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(clipboard.held).toBe('second')
    await vi.advanceTimersByTimeAsync(50_000)
    expect(clipboard.writes).toEqual(['first', 'second', ''])
  })

  test('is known by its digest while it may be on the clipboard, and nothing else is', async () => {
    const clipboard = board()
    await copySecret('s3cret', 15, clipboard)
    expect(isPassSecret('s3cret')).toBe(true)
    expect(isPassSecret('s3cret ')).toBe(false)
    expect(isPassSecret('')).toBe(false)
    await copySecret('other', 15, clipboard)
    expect(isPassSecret('s3cret')).toBe(false)
    expect(isPassSecret('other')).toBe(true)
  })
})
