import { beforeEach, describe, expect, test } from 'vitest'
import type { Page } from '@nib/glasses'
import { type OpenNote, Session, type Showing } from './session'

/** A note as pages, without a canvas anywhere near it.
 *
 *  One page per line, each hashed by its own words, so a test can say which page
 *  the glasses are on by reading the words back and can change one page of a
 *  note without changing the rest. */
function pagesOf(text: string): Page[] {
  // A note with nothing in it has no pages, which is what the real layout says
  // too: there is nothing to set.
  const lines = text ? text.split('\n') : []
  let at = 0

  return lines.map((line, index) => {
    const from = at
    at += line.length + 1

    return {
      index,
      from,
      to: at,
      lines: [],
      tops: [],
      hash: `h:${line}`,
    }
  })
}

/** Where each page landed, in the order it was sent. */
class Fake {
  readonly sent: { hash: string; showing: Showing }[] = []

  show(page: Page, showing: Showing): Promise<void> {
    this.sent.push({ hash: page.hash, showing })
    return Promise.resolve()
  }

  get hashes(): string[] {
    return this.sent.map((one) => one.hash)
  }

  get last(): Showing | undefined {
    return this.sent.at(-1)?.showing
  }
}

const note = (key: string, name: string, text: string): OpenNote => ({ key, name, text })

const FIRST = note('a', 'Groceries', 'one\ntwo\nthree\nfour')
const SECOND = note('b', 'Ideas', 'alpha\nbeta')

let screen: Fake
let session: Session

beforeEach(() => {
  screen = new Fake()
  session = new Session((text) => Promise.resolve(pagesOf(text)), screen)
})

describe('which note the glasses show', () => {
  test('follows the note the plugin makes active', async () => {
    await session.follow(FIRST)

    expect(screen.hashes).toEqual(['h:one'])
    expect(session.showing).toEqual({ key: 'a', name: 'Groceries', page: 0, count: 4 })
  })

  test('switches when the plugin switches', async () => {
    await session.follow(FIRST)
    await session.follow(SECOND)

    expect(screen.hashes).toEqual(['h:one', 'h:alpha'])
    expect(session.showing?.key).toBe('b')
    expect(session.showing?.count).toBe(2)
  })

  test('leaves the note up when the plugin closes it', async () => {
    await session.follow(FIRST)
    await session.turn(1)

    // No note active any more: the plugin's tab is gone and the glasses keep
    // what they had, on the page they had.
    await session.follow(null)
    await session.follow(null)

    expect(screen.hashes).toEqual(['h:one', 'h:two'])
    expect(session.showing).toEqual({ key: 'a', name: 'Groceries', page: 1, count: 4 })
  })

  test('shows nothing at all until a note is active', async () => {
    await session.follow(null)

    expect(screen.sent).toEqual([])
    expect(session.showing).toBeNull()
  })

  test('keeps the last note when the next one has nothing in it', async () => {
    await session.follow(FIRST)
    await session.follow(note('c', 'Empty', ''))

    expect(screen.hashes).toEqual(['h:one'])
    expect(session.showing?.key).toBe('a')
  })
})

describe('turning a page on the glasses', () => {
  test('goes on and back', async () => {
    await session.follow(FIRST)
    await session.turn(1)
    await session.turn(1)
    await session.turn(-1)

    expect(screen.hashes).toEqual(['h:one', 'h:two', 'h:three', 'h:two'])
  })

  test('stops at both ends without sending anything', async () => {
    await session.follow(FIRST)
    await session.turn(-1)
    expect(screen.hashes).toEqual(['h:one'])

    for (let at = 0; at < 6; at++) await session.turn(1)
    expect(screen.hashes).toEqual(['h:one', 'h:two', 'h:three', 'h:four'])
  })

  test('says which page of how many, for the corner of the page', async () => {
    await session.follow(FIRST)
    await session.turn(1)

    expect(screen.last).toEqual({ key: 'a', name: 'Groceries', page: 1, count: 4 })
  })

  test('does nothing before a note is on the glasses', async () => {
    await session.turn(1)
    expect(screen.sent).toEqual([])
  })
})

describe('the page each note is left on', () => {
  test('comes back when the note does', async () => {
    await session.follow(FIRST)
    await session.turn(1)
    await session.turn(1)

    await session.follow(SECOND)
    await session.turn(1)

    await session.follow(FIRST)
    expect(screen.hashes.at(-1)).toBe('h:three')
    expect(session.showing?.page).toBe(2)

    await session.follow(SECOND)
    expect(screen.hashes.at(-1)).toBe('h:beta')
    expect(session.showing?.page).toBe(1)
  })

  test('is clamped when the note grew shorter while it was away', async () => {
    await session.follow(FIRST)
    await session.turn(1)
    await session.turn(1)
    await session.turn(1)
    expect(session.showing?.page).toBe(3)

    await session.follow(SECOND)
    // Back to a note that has lost most of itself somewhere else.
    await session.follow(note('a', 'Groceries', 'one'))

    expect(session.showing).toEqual({ key: 'a', name: 'Groceries', page: 0, count: 1 })
  })
})

describe('an edit under the reader', () => {
  test('sends nothing when the page they are on has not moved', async () => {
    await session.follow(FIRST)
    await session.turn(1)
    const before = screen.hashes.length

    // A later page rewritten. The page in front of them is the same pixels, so
    // the radio stays quiet.
    await session.follow(note('a', 'Groceries', 'one\ntwo\nTHREE\nfour'))

    expect(screen.hashes).toHaveLength(before)
    expect(session.showing?.page).toBe(1)
  })

  test('sends the page they are on when it does move', async () => {
    await session.follow(FIRST)
    await session.turn(1)
    await session.follow(note('a', 'Groceries', 'one\ntwo again\nthree\nfour'))

    expect(screen.hashes.at(-1)).toBe('h:two again')
    expect(session.showing?.page).toBe(1)
  })

  test('keeps the reader on the words they were reading, not on the page number', async () => {
    await session.follow(FIRST)
    await session.turn(1)
    await session.turn(1)
    expect(session.showing?.page).toBe(2)

    // Two pages inserted above them. The words they were on have moved down,
    // and so does the page the glasses show.
    await session.follow(note('a', 'Groceries', 'zero\nhalf\none\ntwo\nthree\nfour'))

    expect(screen.hashes.at(-1)).toBe('h:three')
    expect(session.showing?.page).toBe(4)
  })

  test('does not switch notes when the words happen to match', async () => {
    await session.follow(FIRST)
    await session.turn(1)
    // Another note whose second page reads the same. It is a different note, so
    // it opens where it was left, which is the top.
    await session.follow(note('b', 'Ideas', 'x\ntwo'))

    expect(screen.hashes.at(-1)).toBe('h:x')
    expect(session.showing?.key).toBe('b')
  })
})

describe('a render that lost its race', () => {
  test('does not put an older note back on the glasses', async () => {
    // The first render is held up; the second answers at once. Only the second
    // may reach the glasses, or a switch would flick back to where it was.
    let release = () => undefined
    const held = new Promise<void>((resolve) => {
      release = () => {
        resolve()
        return undefined
      }
    })

    let first = true
    const slow = new Session(async (text) => {
      if (first) {
        first = false
        await held
      }
      return pagesOf(text)
    }, screen)

    const one = slow.follow(FIRST)
    const two = slow.follow(SECOND)
    await two
    release()
    await one

    expect(screen.hashes).toEqual(['h:alpha'])
    expect(slow.showing?.key).toBe('b')
  })
})

describe('coming back to the front', () => {
  test('draws the page that is already there again', async () => {
    await session.follow(FIRST)
    await session.turn(1)
    await session.repaint()

    expect(screen.hashes).toEqual(['h:one', 'h:two', 'h:two'])
  })

  test('has nothing to draw before a note is on the glasses', async () => {
    await session.repaint()
    expect(screen.sent).toEqual([])
  })
})

/** A burst of scrolls, the way a ring sends them: several before the first page
 *  has finished going over the radio.
 *
 *  A page costs the best part of a second on a real link. Every flick used to
 *  start its own four-tile send, so five flicks queued five of them and the
 *  reader waited three seconds while pages they had already scrolled past went
 *  by one at a time. They asked to be on page six, not to watch two to six. */
describe('scrolling faster than the radio', () => {
  /** Lets every promise that is ready settle, without letting time pass. */
  async function flush(): Promise<void> {
    for (let at = 0; at < 8; at++) await Promise.resolve()
  }

  /** A screen that does not answer until it is told to, which is what a slow
   *  link is. */
  class Slow {
    readonly sent: string[] = []
    private readonly waiting: (() => void)[] = []

    show(page: Page): Promise<void> {
      this.sent.push(page.hash)
      return new Promise<void>((resolve) => this.waiting.push(resolve))
    }

    /** Lets the send in flight finish. */
    async land(): Promise<void> {
      await flush()
      this.waiting.shift()?.()
      await flush()
    }

    get inFlight(): number {
      return this.waiting.length
    }
  }

  const LONG: OpenNote = {
    key: 'long',
    name: 'Long',
    text: 'one\ntwo\nthree\nfour\nfive\nsix\nseven',
  }

  async function reading(): Promise<{ slow: Slow; paced: Session }> {
    const slow = new Slow()
    const paced = new Session((text) => Promise.resolve(pagesOf(text)), slow)

    const following = paced.follow(LONG)
    await slow.land()
    await following

    return { slow, paced }
  }

  test('costs two sends for a burst of five, not five', async () => {
    const { slow, paced } = await reading()
    expect(slow.sent).toEqual(['h:one'])

    // Five flicks of the ring, none of them waited for. The first is already on
    // the radio and cannot be called back; the other four are one send between
    // them, for where the reader ended up.
    const turns = [1, 1, 1, 1, 1].map((by) => paced.turn(by))
    await flush()
    expect(slow.sent).toEqual(['h:one', 'h:two'])

    await slow.land()
    expect(slow.sent).toEqual(['h:one', 'h:two', 'h:six'])

    await slow.land()
    await Promise.all(turns)

    // Pages three, four and five were scrolled past and never drawn: five page
    // costs became two.
    expect(slow.sent).toEqual(['h:one', 'h:two', 'h:six'])
    expect(paced.showing?.page).toBe(5)
  })

  test('never runs two sends at once, whatever arrives meanwhile', async () => {
    const { slow, paced } = await reading()

    const first = paced.turn(1)
    await flush()
    expect(slow.inFlight).toBe(1)

    // More scrolls while the radio is busy. The channel wedges if two image
    // sends overlap, so there must still be exactly one.
    const more = [paced.turn(1), paced.turn(1)]
    await flush()
    expect(slow.inFlight).toBe(1)

    await slow.land()
    // The catch-up send, for where the reader ended up rather than where they
    // passed through.
    expect(slow.sent).toEqual(['h:one', 'h:two', 'h:four'])

    await slow.land()
    await Promise.all([first, ...more])
    expect(paced.showing?.page).toBe(3)
  })

  test('scrolling back over the pages it skipped lands on the right one', async () => {
    const { slow, paced } = await reading()

    const forward = [paced.turn(1), paced.turn(1), paced.turn(1)]
    await flush()
    const back = [paced.turn(-1), paced.turn(-1)]

    await slow.land()
    await slow.land()
    await Promise.all([...forward, ...back])

    // Three on and two back is one on.
    expect(paced.showing?.page).toBe(1)
    expect(slow.sent.at(-1)).toBe('h:two')
  })
})
