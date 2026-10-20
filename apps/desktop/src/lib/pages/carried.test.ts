import { beforeEach, describe, expect, test, vi } from 'vitest'
import { type Carrying, carryPapers, forgetLacking, namesAPaper, paperFor } from './carried'

/** A page note's paper carried with the note (#551): up once from the device that has
 *  it, down onto a device that has the note and not the paper, and never asked about
 *  for a page note of blank sheets. */

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
  nib: { pages: [{ id: 'p1', paper: 'a4', pattern: 'blank' }] },
})

const BLANK = JSON.stringify({
  nodes: [{ id: 'p1', type: 'group', label: 'Page 1', x: 0, y: 0, width: 595, height: 842 }],
  edges: [],
  nib: { pages: [{ id: 'p1', paper: 'a4', pattern: 'lines' }] },
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
  const how: Carrying = {
    exists: (path) => Promise.resolve(disk.has(path)),
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
    up: (id, hash) => {
      sent.push({ id, hash })
      return Promise.resolve()
    },
    down: (id) => {
      asked.push(id)
      return Promise.resolve(account[id] ?? null)
    },
    carried: new Map(),
    kept,
  }
  return { disk, sent, asked, how, kept }
}

beforeEach(() => forgetLacking())

describe('carrying a page note’s paper', () => {
  test('sends it up once, named by its bytes', async () => {
    const { sent, how, kept } = world({
      '/s/Lecture.pages': WITH_PAPER,
      '/s/Lecture.pages.pdf': PDF,
    })
    const notes = [{ path: '/s/Lecture.pages', id: 'n1', writes: true }]

    await carryPapers(notes, how)
    await carryPapers(notes, how)

    expect(sent).toEqual([{ id: 'n1', hash: `hash-${String(PDF.byteLength)}` }])
    expect(how.carried.get('n1')).toBe(`hash-${String(PDF.byteLength)}`)
    expect(kept).toHaveBeenCalled()
  })

  test('does not send it from a space shared to read', async () => {
    const { sent, how } = world({ '/s/Lecture.pages': WITH_PAPER, '/s/Lecture.pages.pdf': PDF })
    await carryPapers([{ path: '/s/Lecture.pages', id: 'n1', writes: false }], how)
    expect(sent).toEqual([])
  })

  test('brings it down beside a note that has none here', async () => {
    const { disk, asked, how } = world({ '/s/Lecture.pages': WITH_PAPER }, { n1: PDF })
    await carryPapers([{ path: '/s/Lecture.pages', id: 'n1', writes: false }], how)

    expect(asked).toEqual(['n1'])
    expect(disk.get('/s/Lecture.pages.pdf')).toBe(PDF)
  })

  test('never asks about a page note of blank sheets', async () => {
    const { asked, how } = world({ '/s/Sketch.pages': BLANK })
    await carryPapers([{ path: '/s/Sketch.pages', id: 'n2', writes: true }], how)
    expect(asked).toEqual([])
  })

  /** The device that made the note may not have carried it up yet: asked again, but
   *  not on every pass. */
  test('asks again a while after the account had none', async () => {
    vi.useFakeTimers()
    try {
      const { asked, how } = world({ '/s/Lecture.pages': WITH_PAPER })
      const notes = [{ path: '/s/Lecture.pages', id: 'n1', writes: true }]

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
    how.up = (id, hash) => (id === 'a' ? Promise.reject(new Error('offline')) : up(id, hash))

    await carryPapers(
      [
        { path: '/s/A.pages', id: 'a', writes: true },
        { path: '/s/B.pages', id: 'b', writes: true },
      ],
      how,
    )
    expect(sent.map((one) => one.id)).toEqual(['b'])
  })
})

describe('the paper of a page that opens before it came', () => {
  test('is kept beside the note it belongs to', async () => {
    const { disk, how } = world({ '/s/Lecture.pages': WITH_PAPER }, { n1: PDF })
    expect(await paperFor('n1', '/s/Lecture.pages', how)).toBe(PDF)
    expect(disk.get('/s/Lecture.pages.pdf')).toBe(PDF)
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

test('a page note names a paper only where a page is drawn on one', () => {
  expect(namesAPaper(WITH_PAPER)).toBe(true)
  expect(namesAPaper(BLANK)).toBe(false)
  expect(namesAPaper(null)).toBe(false)
  expect(namesAPaper('not json')).toBe(false)
})
