import { describe, expect, test } from 'vitest'

import { fromBase64 } from '../bytes'
import { LOCKED, SESSION } from './chromium.fixture'
import { readSnss } from './snss'

describe("Chromium's session file", () => {
  test('replays to the open window: its tabs in order, pinned and grouped', () => {
    const read = readSnss(fromBase64(SESSION))
    if (read === null || read === 'locked') throw new Error('the fixture is a session')

    expect(read.windows).toHaveLength(1)
    const tabs = read.windows[0]?.tabs ?? []
    expect(tabs.map((one) => [one.url, one.pinned])).toEqual([
      ['https://mail.example.com/', true],
      ['https://news.example.com/today', false],
      ['https://docs.example.com/guide', false],
      ['https://docs.example.com/api', false],
      ['https://later.example.com/', false],
    ])
    const [docs, , later] = [tabs[2]?.group, tabs[3]?.group, tabs[4]?.group]
    expect(docs).toBeTruthy()
    expect(tabs[3]?.group).toBe(docs)
    expect(later).not.toBe(docs)
    expect(read.groups.get(docs ?? '')).toBe('Docs')
    expect(read.groups.get(later ?? '')).toBe('')
    // Written before the pages had drawn their titles, which a session catches up on.
    expect(tabs[1]?.title).toBe('')
  })

  test('says an encrypted one is locked, and anything else is not a session', () => {
    expect(readSnss(LOCKED)).toBe('locked')
    expect(readSnss(new TextEncoder().encode('not a session'))).toBeNull()
  })

  test('reads as far as a file cut short goes', () => {
    const whole = fromBase64(SESSION)
    const read = readSnss(whole.subarray(0, Math.floor(whole.length / 2)))
    expect(read).not.toBeNull()
    expect(read).not.toBe('locked')
  })
})
