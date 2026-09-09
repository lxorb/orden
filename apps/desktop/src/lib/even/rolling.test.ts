import { BODY_INNER, BODY_ROWS } from '@nib/glasses'
import { describe, expect, test } from 'vitest'
import { type OpenNote, Session } from './session'

/** The scroll mode where the glasses scroll rather than the app turning pages.
 *
 *  Emil, on his own glasses: *"native glasses scroll mode is broken on the device: the
 *  bar at the side shows but scrolling does nothing."* It was written as the whole note
 *  in one band for the firmware to scroll itself, and that is what the bar was - the
 *  firmware saying the band overflows its container. Nothing scrolled it: there is no
 *  call in the SDK that does, `TextContainerUpgrade`'s `contentOffset` is undocumented
 *  and untried, and a flick of a temple only turned a page the reader could not see.
 *
 *  So the app scrolls it, a line at a time: the note is cut into pages of a single row
 *  and the panel shows a window of eight of them. One send of about 83 ms a flick, the
 *  same as a page turn, and the note moves by a line the way a scroll should. */

const rows = (source: string) => ({
  breakAt: 0,
  gutter: 0,
  inner: BODY_INNER,
  rows: 1,
  source,
})

const LINES = Array.from({ length: 20 }, (_one, at) => `Line ${String(at + 1)}`).join('\n')

function rolling(source = LINES): Session {
  const session = new Session()
  const { source: text, ...paging } = rows(source)
  const open: OpenNote = { key: 'a', name: 'A note', text }
  session.follow(open, paging, BODY_ROWS)
  return session
}

describe('a note the glasses are scrolling', () => {
  test('shows a window of eight rows rather than one row', () => {
    const session = rolling()

    expect(session.words.split('\n')).toHaveLength(BODY_ROWS)
    expect(session.words.split('\n')[0]).toBe('Line 1')
    expect(session.words.split('\n')[7]).toBe('Line 8')
  })

  test('moves by one line on a scroll, not by a panel', () => {
    const session = rolling()

    session.turn(1)
    expect(session.words.split('\n')[0]).toBe('Line 2')
    session.turn(1)
    expect(session.words.split('\n')[0]).toBe('Line 3')
    session.turn(-1)
    expect(session.words.split('\n')[0]).toBe('Line 2')
  })

  /** The bug, as a test: a scroll that changes nothing on the glass is a scroll the
   *  reader gave for nothing. */
  test('and every one of those scrolls is worth a send', () => {
    const session = rolling()
    session.drew()

    session.turn(1)
    expect(session.moved).toBe(true)
    session.drew()
    expect(session.moved).toBe(false)
  })

  test('stops where the window still fills the panel', () => {
    const session = rolling()

    for (let at = 0; at < 100; at++) session.turn(1)

    const shown = session.words.split('\n')
    expect(shown).toHaveLength(BODY_ROWS)
    expect(shown.at(-1)).toBe('Line 20')
  })

  test('marks exactly the region on the panel, for the frame on the phone', () => {
    const session = rolling()
    const first = session.showing

    session.turn(3)
    const after = session.showing

    expect(after?.from).toBeGreaterThan(first?.from ?? 0)
    expect(after?.firstLine).toBe(4)
    expect(after?.lastLine).toBe(11)
    // The whole window, not the first row of it.
    expect(after?.to).toBeGreaterThan(after?.from ?? 0)
  })

  test('counts scrolls rather than pages, so a page number would be a lie', () => {
    const session = rolling()

    // Twenty rows, eight on the panel: thirteen places to stand. Which is why the
    // head says no page number at all in this mode; see shell.ts.
    expect(session.showing?.count).toBe(13)
    expect(session.windowed).toBe(true)
  })

  test('holds an offset anywhere in the window, so the phone’s scroll settles', () => {
    const session = rolling()
    const showing = session.showing

    expect(session.holds(showing?.from ?? 0)).toBe(true)
    expect(session.holds((showing?.to ?? 1) - 1)).toBe(true)
    expect(session.holds(showing?.to ?? 0)).toBe(false)
  })

  test('carries a line number for every row it shows', () => {
    const session = new Session()
    session.follow(
      { key: 'a', name: 'A note', text: LINES },
      { breakAt: 0, gutter: 54, inner: BODY_INNER, rows: 1 },
      BODY_ROWS,
    )

    const numbers = session.numbers.split('\n')
    expect(numbers).toHaveLength(BODY_ROWS)
    expect(numbers[0]?.trim()).toBe('1')
    expect(numbers[7]?.trim()).toBe('8')
  })

  test('and the ordinary mode is one page at a time, as it always was', () => {
    const session = new Session()
    session.follow(
      { key: 'a', name: 'A note', text: LINES },
      { breakAt: 0, gutter: 0, inner: BODY_INNER, rows: BODY_ROWS },
    )

    expect(session.windowed).toBe(false)
    expect(session.words.split('\n')).toHaveLength(BODY_ROWS)
    session.turn(1)
    // A whole panel on, rather than a line.
    expect(session.words.split('\n')[0]).toBe('Line 9')
  })
})

/** What the card on the phone follows while a finger is dragging.
 *
 *  Emil: *"it doesn't change WHILE scrolling but you kinda need to pause for it to
 *  react."* The card was drawn around the page the glasses had, and the glasses are
 *  told a tenth of a second after the thumb stops - so it sat still through the drag
 *  and jumped afterwards. `regionAt` answers the same question about any offset,
 *  with none of the consequences. */
describe('where the panel would be', () => {
  test('is the region holding that offset, without going there', () => {
    const session = rolling()
    const first = session.showing

    const later = session.regionAt(60)
    expect(later?.from).toBeGreaterThan(first?.from ?? 0)
    // Nothing moved: the glasses are still where they were, and nothing was written
    // down about a page the reader only scrolled past.
    expect(session.showing?.from).toBe(first?.from)
    expect(session.showing?.page).toBe(first?.page)
  })

  test('stops where the window still fills the panel, like a scroll does', () => {
    const session = rolling()

    const far = session.regionAt(100_000)
    expect(far?.page).toBe(12)
    expect(far?.lastLine).toBe(20)
  })

  test('and is the page that is up when the offset is on it', () => {
    const session = rolling()
    const where = session.showing

    expect(session.regionAt(where?.from ?? 0)?.from).toBe(where?.from)
  })

  test('answers nothing for a note with nothing in it', () => {
    expect(new Session().regionAt(0)).toBeNull()
  })
})
