import { afterEach, describe, expect, test, vi } from 'vitest'
import { busy } from './busy.svelte'

afterEach(() => {
  busy.clear()
  vi.useRealTimers()
})

describe('the line across the top of the document', () => {
  test('is on while work is running and off when it ends', async () => {
    expect(busy.active).toBe(false)

    const done = busy.run('Exporting', () => Promise.resolve('a file'))
    expect(busy.active).toBe(true)
    expect(busy.label).toBe('Exporting')

    expect(await done).toBe('a file')
    expect(busy.active).toBe(false)
    expect(busy.label).toBeNull()
  })

  test('goes off however the work ends', async () => {
    await expect(busy.run('Exporting', () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(busy.active).toBe(false)
  })

  /** Counted rather than flagged: two exports at once, and the first to finish
   *  is not the one that turns the line off. */
  test('stays on until the last of them finishes', async () => {
    let letGo: () => void = () => {
      throw new Error('the held promise was never taken up')
    }
    const held = new Promise<void>((resolve) => {
      letGo = resolve
    })

    const slow = busy.run('Exporting', () => held)
    await busy.run('Exporting', () => Promise.resolve())
    expect(busy.active).toBe(true)

    letGo()
    await slow
    expect(busy.active).toBe(false)
  })
})

/** Work that fails silently and carries on another way is the worst of both: the
 *  wait happened, the result is not what was asked for, and nothing says so. */
describe('what the line says went wrong', () => {
  test('is nothing, until something does', () => {
    expect(busy.trouble).toBeNull()
  })

  test('is the sentence it was given', () => {
    busy.failed('That went to the print dialog')
    expect(busy.trouble).toBe('That went to the print dialog')
  })

  test('goes by itself after a moment', () => {
    vi.useFakeTimers()
    busy.failed('That went to the print dialog')

    vi.advanceTimersByTime(4000)
    expect(busy.trouble).toBe('That went to the print dialog')

    vi.advanceTimersByTime(2000)
    expect(busy.trouble).toBeNull()
  })

  test('is the newest of them, and its own moment starts again', () => {
    vi.useFakeTimers()
    busy.failed('The first')
    vi.advanceTimersByTime(4000)
    busy.failed('The second')

    vi.advanceTimersByTime(4000)
    expect(busy.trouble).toBe('The second')
  })

  /** A sentence about an export from a minute ago, over the top of one running
   *  now, is a sentence about the wrong thing. */
  test('goes when the next piece of work starts', async () => {
    busy.failed('That went to the print dialog')
    await busy.run('Exporting', () => Promise.resolve())

    expect(busy.trouble).toBeNull()
  })

  /** But not when a second job starts beside one already running: that one is
   *  what the sentence is about. */
  test('stays while work that is already running fails', async () => {
    await busy.run('Exporting', async () => {
      busy.failed('That went to the print dialog')
      await busy.run('Exporting', () => Promise.resolve())
      expect(busy.trouble).toBe('That went to the print dialog')
    })

    expect(busy.trouble).toBe('That went to the print dialog')
  })
})
