import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { chooseFiles } from './choose-files'

let clicks: HTMLInputElement[] = []

beforeEach(() => {
  clicks = []
  vi.useFakeTimers({ toFake: ['performance'] })
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement,
  ) {
    clicks.push(this)
  })
})

afterEach(() => {
  for (const one of clicks) one.dispatchEvent(new Event('cancel'))
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('choosing files', () => {
  test('a second ask in the same moment, as a double click makes, opens no second chooser', async () => {
    const first = chooseFiles()
    const second = chooseFiles({ folder: true })

    expect(clicks).toHaveLength(1)
    expect(second).toBe(first)

    clicks[0]?.dispatchEvent(new Event('cancel'))
    expect(await second).toEqual([])
  })

  test('once a chooser is answered, the next ask opens one again', async () => {
    const first = chooseFiles()
    clicks[0]?.dispatchEvent(new Event('cancel'))
    await first

    void chooseFiles()
    expect(clicks).toHaveLength(2)
  })

  test('a chooser that never answered does not hold back an ask a moment later', () => {
    void chooseFiles()
    vi.advanceTimersByTime(1500)
    void chooseFiles()

    expect(clicks).toHaveLength(2)
  })
})
