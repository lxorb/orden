import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const store = vi.hoisted(() => ({
  records: new Map<string, string>(),
  reads: 0,
  reading: null as ((path: string) => void) | null,
}))

vi.mock('../../platform/src/tauri', () => ({
  isNative: false,
  platform: () => 'linux',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    const at = args.path as string

    switch (command) {
      case 'read_paper_text': {
        store.reads += 1
        const content = store.records.get(at) ?? ''
        store.reading?.(at)
        return Promise.resolve(content)
      }
      case 'write_paper_text': {
        const content = args.content as string
        if (content) store.records.set(at, content)
        else store.records.delete(at)
        return Promise.resolve(undefined)
      }
      case 'list_paper_texts':
        return Promise.resolve(
          [...store.records].map(([path, content]) => ({ path, size: content.length })),
        )
      default:
        return Promise.reject(new Error(`no such command: ${command}`))
    }
  },
}))

const {
  forgetPapers,
  paperGone,
  paperMoved,
  paperOpened,
  paperRead,
  papersFor,
  papersHeld,
  papersListed,
  papersRead,
  searchPapers,
  writePapers,
} = await import('./papers')
const { parseQuery } = await import('@orden/scan/search/query')
const { shownName } = await import('@orden/markdown/note-name')

const ROOT = '/space'

const page = (text: string) => text.split(' ')

const found = (source: string, excluded: readonly string[] = []) =>
  searchPapers(ROOT, parseQuery(source), 20, excluded)

beforeEach(() => {
  forgetPapers()
  store.records.clear()
  store.reads = 0
  store.reading = null
})

afterEach(() => {
  forgetPapers()
})

describe('a paper that has been read', () => {
  beforeEach(() => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 1, page('a study of ink on paper and its wear'))
    paperRead(`${ROOT}/papers/Ink.pdf`, 4, page('the kestrel hangs on the wind above the field'))
  })

  test('answers a query about its words', () => {
    const hits = found('kestrel')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.page).toBe(4)
    expect(hits[0]?.name).toBe('Ink.pdf')
    expect(hits[0]?.path).toBe(`${ROOT}/papers/Ink.pdf`)
  })

  test('and the row is the words around the match, with the match in it', () => {
    const [hit] = found('kestrel')
    const range = hit?.ranges[0]

    expect(hit?.text).toContain('kestrel')
    expect(hit?.text.slice(range?.from, range?.to)).toBe('kestrel')
  })

  test('and answers once per page rather than once per word', () => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 7, page('ink ink ink ink ink'))

    expect(found('ink').map((hit) => hit.page)).toEqual([1, 7])
  })

  test('and the paper a page note holds is named as the note is (#400)', () => {
    paperRead(`${ROOT}/papers/Kestrel study.pages.pdf`, 1, page('a kestrel study'))

    const [hit] = found('study').filter((one) => one.path.endsWith('.pages.pdf'))
    expect(hit?.name).toBe('Kestrel study.pages')
    expect(shownName(hit?.name ?? '')).toBe('Kestrel study')
    expect(hit?.page).toBe(1)
  })

  test('and its pages come in the order they are in the paper', () => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 2, page('wind again'))

    expect(found('wind').map((hit) => hit.page)).toEqual([2, 4])
  })

  test('and a run is not joined to the next into a word neither says', () => {
    paperRead(`${ROOT}/papers/Odd.pdf`, 1, ['some', 'thing'])

    expect(found('something')).toEqual([])
    expect(found('some thing')).toHaveLength(1)
  })

  test('and the operators mean what they mean in a note', () => {
    expect(found('file:Ink').map((hit) => hit.page)).toEqual([1, 4])
    expect(found('path:papers').length).toBeGreaterThan(0)
    expect(found('kestrel -wind')).toEqual([])
  })

  test('and a paper the space leaves out answers nothing', () => {
    expect(found('kestrel', ['papers'])).toEqual([])
    expect(found('kestrel', ['papers/Ink.pdf'])).toEqual([])
    expect(found('kestrel', ['paper'])).toHaveLength(1)
  })

  test('and a paper in another space is not this space s to answer', () => {
    paperRead('/elsewhere/Other.pdf', 1, page('kestrel again'))

    expect(found('kestrel').map((hit) => hit.path)).toEqual([`${ROOT}/papers/Ink.pdf`])
  })

  test('and one that has gone answers nothing', () => {
    paperGone(`${ROOT}/papers/Ink.pdf`)

    expect(found('kestrel')).toEqual([])
    expect(papersRead()).toBe(0)
  })
})

describe('a space where nothing has been read', () => {
  test('answers nothing, and costs nothing to ask', () => {
    expect(found('kestrel')).toEqual([])
    expect(papersRead()).toBe(0)
  })

  test('and a page with no words in it is not an answer', () => {
    paperRead(`${ROOT}/Blank.pdf`, 1, ['', '  '])

    expect(found('anything')).toEqual([])
  })
})

describe('a paper read in an earlier sitting', () => {
  const PAPER = `${ROOT}/papers/Ink.pdf`

  const listed = (modified: number) => new Map([[PAPER, modified]])

  const readBack = async (modified: number) => {
    papersListed(ROOT, listed(modified))
    await papersFor(ROOT)
  }

  test('is written down and answers again after everything is forgotten', async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 3, page('a study of ink on paper and its wear'))
    await writePapers()

    forgetPapers()
    expect(found('ink')).toEqual([])

    await readBack(10)
    const hits = found('ink')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.page).toBe(3)
    expect(papersHeld().papers).toBe(1)
  })

  test('is read back once per space however often a search asks', async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink again'))
    await writePapers()
    forgetPapers()

    await readBack(10)
    store.reads = 0

    await papersFor(ROOT)
    await papersFor(ROOT)
    expect(store.reads).toBe(0)
    expect(papersHeld().papers).toBe(1)
  })

  test('is not trusted when the file has been written since', async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink as it was'))
    await writePapers()
    forgetPapers()

    await readBack(11)
    expect(found('ink')).toEqual([])
  })

  test('and a paper whose bytes are now something else loses the words that were its', () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink as it was'))
    expect(found('ink')).toHaveLength(1)

    paperOpened(PAPER, 'def', 12)
    expect(found('ink')).toEqual([])
  })

  test('and a paper nobody has named is held for the sitting and written nowhere', async () => {
    paperRead(PAPER, 1, page('ink from nowhere'))
    await writePapers()

    expect(found('ink')).toHaveLength(1)
    expect(store.records.size).toBe(0)
  })

  test('and one that has gone takes its words out of the store as well', async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink'))
    await writePapers()
    expect(store.records.size).toBe(1)

    paperGone(PAPER)
    await Promise.resolve()
    expect(store.records.size).toBe(0)
  })
})

describe('a paper that changes while the store is being read back', () => {
  const PAPER = `${ROOT}/papers/Ink.pdf`
  const listed = (modified: number) => new Map([[PAPER, modified]])

  const readBack = async (modified: number) => {
    papersListed(ROOT, listed(modified))
    await papersFor(ROOT)
  }

  const takenDown = async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('a study of ink on paper and its wear'))
    await writePapers()
    forgetPapers()
  }

  test('is not put back when it was deleted while the walk was in the air', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperGone(PAPER)
    }
    await readBack(10)

    expect(found('ink')).toEqual([])
    expect(papersRead()).toBe(0)
  })

  test('and is not put back under the name a rename took away', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperMoved(PAPER, `${ROOT}/papers/Wear.pdf`)
    }
    await readBack(10)

    expect(found('ink').map((one) => one.path)).toEqual([])
  })

  test('and not under it when the folder it sat in is what moved', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperMoved(`${ROOT}/papers`, `${ROOT}/shelf`)
    }
    await readBack(10)

    expect(found('ink').map((one) => one.path)).toEqual([])
  })

  test('and a paper nothing touched still lands', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperGone(`${ROOT}/papers/Other.pdf`)
    }
    await readBack(10)

    expect(found('ink')).toHaveLength(1)
  })

  test('and the next read-back of the space is not held to what the last one missed', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperGone(PAPER)
    }
    await readBack(10)
    expect(found('ink')).toEqual([])

    store.reading = null
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink once more'))
    expect(found('ink')).toHaveLength(1)
  })
})

describe('a space read back before the file list has said anything', () => {
  const PAPER = `${ROOT}/papers/Ink.pdf`
  const listed = (modified: number) => new Map([[PAPER, modified]])

  beforeEach(async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('a study of ink on paper and its wear'))
    await writePapers()
    forgetPapers()
  })

  test('answers from the store, because nothing has said what the file looks like now', async () => {
    await papersFor(ROOT)
    expect(found('ink')).toHaveLength(1)
  })

  test('and lets go of the words once the listing says the file has been written since', async () => {
    await papersFor(ROOT)
    expect(found('ink')).toHaveLength(1)

    papersListed(ROOT, listed(11))
    expect(found('ink')).toEqual([])

    await papersFor(ROOT)
    expect(found('ink')).toEqual([])
  })

  test('and keeps them where the listing says the file is the one they came from', async () => {
    await papersFor(ROOT)
    papersListed(ROOT, listed(10))
    await papersFor(ROOT)

    expect(found('ink')).toHaveLength(1)
  })

  test('and the listing landing first is what the search is held to', async () => {
    papersListed(ROOT, listed(11))
    await papersFor(ROOT)

    expect(found('ink')).toEqual([])
  })

  test('and one that lands while the walk is in the air is held against it too', async () => {
    store.reading = (path) => {
      if (path === PAPER) papersListed(ROOT, listed(11))
    }
    await papersFor(ROOT)

    expect(found('ink')).toEqual([])
  })
})

const settled = () => new Promise((done) => setTimeout(done, 0))

const walked = (notes: string[], folders: string[] = [ROOT]) => ({ notes, folders })

describe('the paper a page note holds', () => {
  const NOTE = `${ROOT}/Lecture.pages`
  const PAPER = `${ROOT}/Lecture.pages.pdf`

  beforeEach(async () => {
    paperOpened(PAPER, 'h1', 1)
    paperRead(PAPER, 1, page('entropy of a closed system'))
    await writePapers()
  })

  test('follows the note renamed, in memory and in the store', async () => {
    paperMoved(NOTE, `${ROOT}/Physics.pages`)
    await writePapers()
    await settled()

    expect(found('entropy').map((hit) => hit.path)).toEqual([`${ROOT}/Physics.pages.pdf`])
    expect(store.records.has(PAPER)).toBe(false)
    expect(store.records.has(`${ROOT}/Physics.pages.pdf`)).toBe(true)
  })

  test('follows the note into another space', () => {
    paperMoved(NOTE, '/other/shelf/Lecture.pages')

    expect(found('entropy')).toEqual([])
    const there = searchPapers('/other', parseQuery('entropy'), 20)
    expect(there.map((hit) => hit.path)).toEqual(['/other/shelf/Lecture.pages.pdf'])
  })

  test('goes with the note deleted, in memory and in the store', () => {
    paperGone(NOTE)

    expect(found('entropy')).toEqual([])
    expect(store.records.has(PAPER)).toBe(false)
  })

  test('follows the note renamed while its words were only in the store', async () => {
    forgetPapers()
    paperMoved(NOTE, `${ROOT}/Physics.pages`)
    await settled()

    expect(store.records.has(PAPER)).toBe(false)
    expect(store.records.has(`${ROOT}/Physics.pages.pdf`)).toBe(true)
  })

  test('does not come back under the old name from a walk in the air', async () => {
    forgetPapers()
    store.reading = (path) => {
      if (path === PAPER) paperMoved(NOTE, `${ROOT}/Physics.pages`)
    }
    await papersFor(ROOT)

    expect(found('entropy').map((hit) => hit.path)).not.toContain(PAPER)
  })

  test('left behind by an older build is dropped once the list says its note is gone', async () => {
    forgetPapers()
    papersListed(ROOT, new Map(), walked([]))
    await papersFor(ROOT)

    expect(found('entropy')).toEqual([])
    await settled()
    expect(store.records.has(PAPER)).toBe(false)
  })

  test('left behind and read back before the list said anything is dropped when it does', async () => {
    forgetPapers()
    await papersFor(ROOT)
    expect(found('entropy')).toHaveLength(1)

    papersListed(ROOT, new Map(), walked([]))
    expect(found('entropy')).toEqual([])
    await papersFor(ROOT)
    expect(found('entropy')).toEqual([])
    expect(store.records.has(PAPER)).toBe(false)
  })

  test('of another space is left alone by the list of this one', () => {
    paperOpened('/other/Talk.pages.pdf', 'h2', 1)
    paperRead('/other/Talk.pages.pdf', 1, page('entropy again'))
    papersListed(ROOT, new Map(), walked([NOTE]))

    expect(searchPapers('/other', parseQuery('entropy'), 20)).toHaveLength(1)
  })

  test('is kept where the list still has its note', async () => {
    forgetPapers()
    papersListed(ROOT, new Map(), walked([NOTE]))
    await papersFor(ROOT)

    expect(found('entropy').map((hit) => hit.path)).toEqual([PAPER])
    expect(store.records.has(PAPER)).toBe(true)
  })

  test('is kept where the list could not be read at all', async () => {
    forgetPapers()
    papersListed(ROOT, new Map(), null)
    await papersFor(ROOT)
    await settled()

    expect(found('entropy')).toHaveLength(1)
    expect(store.records.has(PAPER)).toBe(true)
  })

  test('is kept where the list did not read the folder it sits in', async () => {
    const hidden = `${ROOT}/Locked/Optics.pages.pdf`
    paperOpened(hidden, 'h3', 1)
    paperRead(hidden, 1, page('optics of a lens'))
    await writePapers()
    forgetPapers()

    papersListed(ROOT, new Map(), walked([NOTE]))
    await papersFor(ROOT)
    await settled()

    expect(found('optics')).toHaveLength(1)
    expect(store.records.has(hidden)).toBe(true)
  })

  test('is kept as a PDF of its own where the list has it as a file', async () => {
    forgetPapers()
    papersListed(ROOT, new Map([[PAPER, 1]]), walked([]))
    await papersFor(ROOT)
    await settled()

    expect(found('entropy')).toHaveLength(1)
    expect(store.records.has(PAPER)).toBe(true)
  })
})

describe('papers inside a folder or a space', () => {
  const PAPER = `${ROOT}/Week/Ink.pdf`
  const NOTED = `${ROOT}/Week/Optics.pages.pdf`

  beforeEach(async () => {
    paperOpened(PAPER, 'h1', 1)
    paperRead(PAPER, 1, page('ink on paper'))
    paperOpened(NOTED, 'h2', 1)
    paperRead(NOTED, 1, page('ink in a lens'))
    await writePapers()
  })

  test('go with the folder deleted, in memory and in the store', async () => {
    paperGone(`${ROOT}/Week`)
    await settled()

    expect(found('ink')).toEqual([])
    expect(store.records.size).toBe(0)
  })

  test('go with the folder deleted while their words were only in the store', async () => {
    forgetPapers()
    paperGone(`${ROOT}/Week`)
    await settled()

    expect(store.records.size).toBe(0)
  })

  test('follow a space renamed, those only in the store too', async () => {
    forgetPapers()
    paperRead(PAPER, 1, page('ink on paper'))
    paperOpened(PAPER, 'h1', 1)
    paperMoved(ROOT, '/renamed')
    await writePapers()
    await settled()

    expect([...store.records.keys()].sort()).toEqual([
      '/renamed/Week/Ink.pdf',
      '/renamed/Week/Optics.pages.pdf',
    ])
    expect(searchPapers('/renamed', parseQuery('ink'), 20)).toHaveLength(1)
  })
})
