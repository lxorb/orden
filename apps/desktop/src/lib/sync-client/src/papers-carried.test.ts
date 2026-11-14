import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../../accounts/src/api'
import {
  type Carrying,
  carryPapers,
  forgetLacking,
  namesAPaper,
  paperFor,
  paperRetryDelay,
} from './papers-carried'

const WITH_PAPER = JSON.stringify({
  nodes: [
    {
      id: 'p1',
      type: 'file',
      file: 'Lecture.pages.pdf',
      subpath: '#page=1',
      x: 0,
      y: 0,
      width: 595,
      height: 842,
    },
  ],
  edges: [],
  orden: { pages: [{ id: 'p1', paper: 'a4', pattern: 'blank' }] },
})

const BLANK = JSON.stringify({
  nodes: [{ id: 'p1', type: 'group', label: 'Page 1', x: 0, y: 0, width: 595, height: 842 }],
  edges: [],
  orden: { pages: [{ id: 'p1', paper: 'a4', pattern: 'lines' }] },
})

const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n')

function world(
  files: Record<string, string | Uint8Array>,
  account: Record<string, Uint8Array> = {},
) {
  const disk = new Map(Object.entries(files))
  const sent: { id: string; hash: string }[] = []
  const asked: string[] = []
  const kept = vi.fn()
  const stamps = new Map<string, string>()
  const said: string[] = []
  const how: Carrying = {
    exists: (path) => Promise.resolve(disk.has(path)),
    stamp: (path) => Promise.resolve(stamps.get(path) ?? null),
    read: (path) => {
      const held = disk.get(path)
      return Promise.resolve(held instanceof Uint8Array ? held : null)
    },
    write: (path, bytes) => {
      disk.set(path, bytes)
      return Promise.resolve()
    },
    text: (path) => {
      const held = disk.get(path)
      return Promise.resolve(typeof held === 'string' ? held : null)
    },
    hash: (bytes) => Promise.resolve(`hash-${String(bytes.byteLength)}`),
    up: () => Promise.resolve(),
    hold: (id, hash) => {
      sent.push({ id, hash })
      return Promise.resolve()
    },
    down: (id) => {
      asked.push(id)
      return Promise.resolve(account[id] ?? null)
    },
    carried: new Map(),
    kept,
    said: (note, failed) => said.push(`${note.space}: ${failed}`),
  }
  return { disk, sent, asked, how, kept, stamps, said }
}

beforeEach(() => forgetLacking())

describe('carrying a page note’s paper', () => {
  test('sends it up once, named by its bytes', async () => {
    const { sent, how, kept } = world({
      '/s/Lecture.pages': WITH_PAPER,
      '/s/Lecture.pages.pdf': PDF,
    })
    const notes = [{ path: '/s/Lecture.pages', id: 'n1', writes: true, space: 'Work' }]

    await carryPapers(notes, how)
    await carryPapers(notes, how)

    expect(sent).toEqual([{ id: 'n1', hash: `hash-${String(PDF.byteLength)}` }])
    expect(how.carried.get('n1')).toBe(`hash-${String(PDF.byteLength)}`)
    expect(kept).toHaveBeenCalled()
  })

  test('does not send it from a space shared to read', async () => {
    const { sent, how } = world({ '/s/Lecture.pages': WITH_PAPER, '/s/Lecture.pages.pdf': PDF })
    await carryPapers([{ path: '/s/Lecture.pages', id: 'n1', writes: false, space: 'Work' }], how)
    expect(sent).toEqual([])
  })

  test('brings it down beside a note that has none here', async () => {
    const { disk, asked, how } = world({ '/s/Lecture.pages': WITH_PAPER }, { n1: PDF })
    await carryPapers([{ path: '/s/Lecture.pages', id: 'n1', writes: false, space: 'Work' }], how)

    expect(asked).toEqual(['n1'])
    expect(disk.get('/s/Lecture.pages.pdf')).toBe(PDF)
  })

  test('never asks about a page note of blank sheets', async () => {
    const { asked, how } = world({ '/s/Sketch.pages': BLANK })
    await carryPapers([{ path: '/s/Sketch.pages', id: 'n2', writes: true, space: 'Work' }], how)
    expect(asked).toEqual([])
  })

  test('asks again a while after the account had none', async () => {
    vi.useFakeTimers()
    try {
      const { asked, how } = world({ '/s/Lecture.pages': WITH_PAPER })
      const notes = [{ path: '/s/Lecture.pages', id: 'n1', writes: true, space: 'Work' }]

      await carryPapers(notes, how)
      await carryPapers(notes, how)
      expect(asked).toEqual(['n1'])

      vi.advanceTimersByTime(61_000)
      await carryPapers(notes, how)
      expect(asked).toEqual(['n1', 'n1'])
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([
    ['renamed', '/s/Renamed.pages'],
    ['deleted', null],
  ])('writes nothing for a note %s while its paper came down', async (_, to) => {
    const { disk, how } = world({ '/s/Lecture.pages': WITH_PAPER }, { n1: PDF })
    how.down = () => {
      disk.delete('/s/Lecture.pages')
      if (to) disk.set(to, WITH_PAPER)
      return Promise.resolve(PDF)
    }

    await carryPapers([{ path: '/s/Lecture.pages', id: 'n1', writes: true, space: 'Work' }], how)

    expect(disk.has('/s/Lecture.pages.pdf')).toBe(false)
    expect(how.carried.has('n1')).toBe(false)
  })

  test('goes on past a note that fails', async () => {
    const { sent, how } = world({
      '/s/A.pages': WITH_PAPER,
      '/s/A.pages.pdf': PDF,
      '/s/B.pages': WITH_PAPER,
      '/s/B.pages.pdf': PDF,
    })
    const up = (id: string, hash: string) => {
      sent.push({ id, hash })
      return Promise.resolve()
    }
    how.hold = (id, hash) => (id === 'a' ? Promise.reject(new Error('offline')) : up(id, hash))

    await carryPapers(
      [
        { path: '/s/A.pages', id: 'a', writes: true, space: 'Work' },
        { path: '/s/B.pages', id: 'b', writes: true, space: 'Work' },
      ],
      how,
    )
    expect(sent.map((one) => one.id)).toEqual(['b'])
  })
})

describe('a paper the account will not take', () => {
  const NOTE = { path: '/s/Lecture.pages', id: 'n1', writes: true, space: 'Work' }

  function refusing(answer: () => Promise<void>) {
    const made = world({ '/s/Lecture.pages': WITH_PAPER, '/s/Lecture.pages.pdf': PDF })
    const count = { reads: 0, ups: 0 }
    made.how.read = () => {
      count.reads += 1
      return Promise.resolve(PDF)
    }
    made.how.up = () => {
      count.ups += 1
      return answer()
    }
    made.stamps.set('/s/Lecture.pages.pdf', 'first')
    return { ...made, count }
  }

  const passes = async (times: number, how: Carrying) => {
    for (let at = 0; at < times; at += 1) await carryPapers([NOTE], how)
  }

  beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'] }))
  afterEach(() => void vi.useRealTimers())

  test.each([413, 415, 400])(
    'is not read or sent again after a %i, and is said once',
    async (status) => {
      const { how, count, said } = refusing(() => Promise.reject(new ApiError(status, 'no')))

      await passes(5, how)
      vi.setSystemTime(Date.now() + 24 * 60 * 60_000)
      await passes(5, how)

      expect(count).toEqual({ reads: 1, ups: 1 })
      expect(said).toEqual(['Work: the account would not take Lecture.pages.pdf'])
      expect(how.carried.has('n1')).toBe(false)
    },
  )

  test('goes again once the file changes, and is said again if refused again', async () => {
    let answer: () => Promise<void> = () => Promise.reject(new ApiError(413, 'too big'))
    const { how, count, stamps, said } = refusing(() => answer())

    await passes(3, how)
    stamps.set('/s/Lecture.pages.pdf', 'second')
    await passes(3, how)
    expect(count.ups).toBe(2)
    expect(said).toHaveLength(2)

    answer = () => Promise.resolve()
    stamps.set('/s/Lecture.pages.pdf', 'third')
    await passes(3, how)
    expect(count.ups).toBe(3)
    expect(how.carried.has('n1')).toBe(true)
  })

  test.each([
    ['out of reach', () => new TypeError('fetch failed')],
    ['a 500', () => new ApiError(500, 'oops')],
    ['a 429', () => new ApiError(429, 'slow down')],
    ['a 403', () => new ApiError(403, 'read only for now')],
  ])('waits longer each time after %s, then goes', async (_, error) => {
    let answer: () => Promise<void> = () => Promise.reject(error())
    const { how, count, said } = refusing(() => answer())

    await passes(3, how)
    expect(count.ups).toBe(1)

    vi.setSystemTime(Date.now() + paperRetryDelay(1))
    await passes(3, how)
    expect(count.ups).toBe(2)

    vi.setSystemTime(Date.now() + paperRetryDelay(1))
    await passes(3, how)
    expect(count.ups).toBe(2)

    vi.setSystemTime(Date.now() + paperRetryDelay(2))
    answer = () => Promise.resolve()
    await passes(3, how)
    expect(count.ups).toBe(3)
    expect(how.carried.has('n1')).toBe(true)
    expect(said).toEqual([])
  })

  test('a full account is said once and tried again, since room can be made', async () => {
    let answer: () => Promise<void> = () => Promise.reject(new ApiError(507, 'out of space'))
    const { how, count, said } = refusing(() => answer())

    await passes(3, how)
    vi.setSystemTime(Date.now() + paperRetryDelay(1))
    await passes(3, how)
    expect(count.ups).toBe(2)
    expect(said).toEqual(['Work: no room on the account for Lecture.pages.pdf'])

    vi.setSystemTime(Date.now() + paperRetryDelay(2))
    answer = () => Promise.resolve()
    await passes(1, how)
    expect(how.carried.has('n1')).toBe(true)
  })

  test('holds nobody else up', async () => {
    const LARGE = new Uint8Array(99)
    const { how, sent } = world({
      '/s/A.pages': WITH_PAPER,
      '/s/A.pages.pdf': LARGE,
      '/s/B.pages': WITH_PAPER,
      '/s/B.pages.pdf': PDF,
    })
    how.up = (hash) =>
      hash === 'hash-99' ? Promise.reject(new ApiError(413, 'too big')) : Promise.resolve()

    await carryPapers(
      [
        { ...NOTE, path: '/s/A.pages', id: 'a' },
        { ...NOTE, path: '/s/B.pages', id: 'b' },
      ],
      how,
    )

    expect(sent.map((one) => one.id)).toEqual(['b'])
  })

  test('with nothing to say whether the file changed is tried again later, said once', async () => {
    const { how, count, stamps, said } = refusing(() => Promise.reject(new ApiError(413, 'no')))
    stamps.clear()

    await passes(3, how)
    expect(count.ups).toBe(1)

    vi.setSystemTime(Date.now() + paperRetryDelay(1))
    await passes(3, how)
    expect(count.ups).toBe(2)
    expect(said).toEqual(['Work: the account would not take Lecture.pages.pdf'])
  })

  test('is only what the blob store says: a 400 naming the note clears by itself', async () => {
    const { how, count, said } = refusing(() => Promise.resolve())
    let hold: () => Promise<void> = () => Promise.reject(new ApiError(400, 'not pages yet'))
    how.hold = () => hold()

    await passes(3, how)
    expect(count.ups).toBe(1)
    expect(said).toEqual([])

    vi.setSystemTime(Date.now() + paperRetryDelay(1))
    hold = () => Promise.resolve()
    await passes(1, how)
    expect(count.ups).toBe(2)
    expect(how.carried.has('n1')).toBe(true)
  })

  test('a 401 is the account’s, so the pass stops, and a sign-in starts over', async () => {
    let answer: () => Promise<void> = () => Promise.reject(new ApiError(401, 'signed out'))
    const { how, count } = refusing(() => answer())
    const notes = [NOTE, { ...NOTE, id: 'n2', path: '/s/B.pages' }]
    how.exists = () => Promise.resolve(true)

    await carryPapers(notes, how)
    expect(count).toEqual({ reads: 1, ups: 1 })
    await carryPapers(notes, how)
    expect(count).toEqual({ reads: 1, ups: 1 })

    forgetLacking()
    answer = () => Promise.resolve()
    await carryPapers(notes, how)
    expect(count).toEqual({ reads: 3, ups: 3 })
  })
})

describe('the paper of a page that opens before it came', () => {
  test('is kept beside the note it belongs to', async () => {
    const { disk, how } = world({ '/s/Lecture.pages': WITH_PAPER }, { n1: PDF })
    expect(await paperFor('n1', '/s/Lecture.pages', how)).toBe(PDF)
    expect(disk.get('/s/Lecture.pages.pdf')).toBe(PDF)
  })

  test('is not written where the note left while it came, but still shown', async () => {
    const { disk, how } = world({ '/s/Lecture.pages': WITH_PAPER })
    how.down = () => {
      disk.delete('/s/Lecture.pages')
      return Promise.resolve(PDF)
    }
    expect(await paperFor('n1', '/s/Lecture.pages', how)).toBe(PDF)
    expect([...disk.keys()]).toEqual([])
  })

  test('is held in memory only for a note shared on its own', async () => {
    const { disk, how } = world({}, { n1: PDF })
    expect(await paperFor('n1', null, how)).toBe(PDF)
    expect([...disk.keys()]).toEqual([])
  })

  test('is nothing where the account has none', async () => {
    const { how } = world({})
    expect(await paperFor('n1', null, how)).toBeNull()
  })
})

test('a paper that did not go up waits half a minute, doubling to ten', () => {
  expect(paperRetryDelay(1)).toBe(30_000)
  expect(paperRetryDelay(2)).toBe(60_000)
  expect(paperRetryDelay(20)).toBe(600_000)
})

test('a page note names a paper only where a page is drawn on one', () => {
  expect(namesAPaper(WITH_PAPER)).toBe(true)
  expect(namesAPaper(BLANK)).toBe(false)
  expect(namesAPaper(null)).toBe(false)
  expect(namesAPaper('not json')).toBe(false)
})
