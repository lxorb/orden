import { describe, expect, test } from 'vitest'

import { fromBase64 } from '../bytes'
import { LOCKED, SESSION } from './chromium.fixture'
import { readSnss } from './snss'

/** Little-endian 32-bit numbers, as Chromium's fixed commands are written. */
function ints(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  values.forEach((value, at) => view.setInt32(at * 4, value, true))
  return out
}

/** A page of a tab's history as Chromium writes it: a pickle of the tab, the
 *  page's place, its address and an empty title. */
function navigation(tab: number, index: number, url: string): [number, Uint8Array] {
  const address = new TextEncoder().encode(url)
  const padded = Math.ceil(address.length / 4) * 4
  const body = new Uint8Array(12 + padded + 4)
  body.set(ints(tab, index, address.length), 0)
  body.set(address, 12)
  return [6, new Uint8Array([...ints(body.length), ...body])]
}

/** A session file of these commands, in the clear. */
function snss(...commands: [number, Uint8Array][]): Uint8Array {
  const bytes: number[] = [0x53, 0x4e, 0x53, 0x53, 3, 0, 0, 0]
  for (const [id, said] of commands) {
    const size = said.length + 1
    bytes.push(size & 0xff, size >> 8, id, ...said)
  }
  return new Uint8Array(bytes)
}

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

  test('follows a history Chromium cut, to the page the tab is on now', () => {
    // A tab at the most pages Chromium keeps loses its oldest; the rest move down,
    // and going back then lands on the page that is now first.
    const read = readSnss(
      snss(
        [0, ints(1, 7)],
        [9, ints(1, 0)],
        navigation(7, 0, 'https://a.example.com/'),
        navigation(7, 1, 'https://b.example.com/'),
        navigation(7, 2, 'https://c.example.com/'),
        [7, ints(7, 2)],
        [11, ints(7, 1)],
        [7, ints(7, 0)],
        // A second tab went back from its third page to its first and on to another.
        [0, ints(1, 8)],
        [2, ints(8, 1)],
        navigation(8, 0, 'https://d.example.com/'),
        navigation(8, 1, 'https://e.example.com/'),
        navigation(8, 2, 'https://f.example.com/'),
        [24, ints(8, 1, 2)],
        navigation(8, 1, 'https://g.example.com/'),
      ),
    )
    if (read === null || read === 'locked') throw new Error('a session')
    expect(read.windows[0]?.tabs.map((one) => one.url)).toEqual([
      'https://b.example.com/',
      'https://g.example.com/',
    ])
  })

  test('reads as far as a file cut short goes', () => {
    const whole = fromBase64(SESSION)
    const read = readSnss(whole.subarray(0, Math.floor(whole.length / 2)))
    expect(read).not.toBeNull()
    expect(read).not.toBe('locked')
  })
})
