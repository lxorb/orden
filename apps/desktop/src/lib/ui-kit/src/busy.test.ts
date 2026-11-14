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

  test('says what stopped work nobody is waiting on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    busy.start('Exporting', () => Promise.reject(new Error('the file is locked')))
    await vi.waitFor(() => expect(busy.active).toBe(false))

    expect(busy.trouble).toBe('Exporting: the file is locked')
    vi.restoreAllMocks()
  })

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

  test('goes when the next piece of work starts', async () => {
    busy.failed('That went to the print dialog')
    await busy.run('Exporting', () => Promise.resolve())

    expect(busy.trouble).toBeNull()
  })

  test('stays while work that is already running fails', async () => {
    await busy.run('Exporting', async () => {
      busy.failed('That went to the print dialog')
      await busy.run('Exporting', () => Promise.resolve())
      expect(busy.trouble).toBe('That went to the print dialog')
    })

    expect(busy.trouble).toBe('That went to the print dialog')
  })
})

describe('work asked for again while it is still running', () => {
  test('runs once, and can be asked for again once it is done', async () => {
    let letGo: () => void = () => {
      throw new Error('the held promise was never taken up')
    }
    const held = new Promise<void>((resolve) => {
      letGo = resolve
    })
    const work = vi.fn(() => held)

    busy.start('Printing', work, 'print')
    busy.start('Printing', work, 'print')
    expect(work).toHaveBeenCalledTimes(1)

    letGo()
    await vi.waitFor(() => expect(busy.active).toBe(false))
    await new Promise((resolve) => setTimeout(resolve, 0))

    busy.start('Printing', work, 'print')
    expect(work).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(busy.active).toBe(false))
  })

  test('can be asked for again after it failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    busy.start('Exporting', () => Promise.reject(new Error('no')), 'export-pdf')
    await vi.waitFor(() => expect(busy.active).toBe(false))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const work = vi.fn(() => Promise.resolve())
    busy.start('Exporting', work, 'export-pdf')
    expect(work).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  test('does not hold back different work under the same words', () => {
    const one = vi.fn(() => Promise.resolve())
    const other = vi.fn(() => Promise.resolve())

    busy.start('Exporting', one, 'export-pdf')
    busy.start('Exporting', other, 'export-png')

    expect(one).toHaveBeenCalledTimes(1)
    expect(other).toHaveBeenCalledTimes(1)
  })
})
