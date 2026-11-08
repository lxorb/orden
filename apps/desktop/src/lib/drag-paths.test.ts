import { describe, expect, test, vi } from 'vitest'
import type { Bookmark } from './workspace/bookmarks.svelte'
import {
  carriedIntoNotes,
  carriedNothing,
  carry,
  carryFromExplorer,
  carriesFiles,
  isFileDrop,
  isLinkDrop,
  landing,
  outsideRows,
} from './drag-paths'

function transfer(types: string[] = []): DataTransfer {
  const data = new Map<string, string>()
  const held = {
    types,
    effectAllowed: 'none',
    setData: (type: string, value: string) => {
      data.set(type, value)
      if (!types.includes(type)) types.push(type)
    },
    getData: (type: string) => data.get(type) ?? '',
  }
  return held as unknown as DataTransfer
}

const drop = (dataTransfer: DataTransfer, keys: { ctrlKey?: boolean; altKey?: boolean } = {}) => ({
  dataTransfer,
  ctrlKey: keys.ctrlKey ?? false,
  altKey: keys.altKey ?? false,
})

describe('a drop on the file list', () => {
  test('moves its own rows, and lets the one dragging choose a copy instead', () => {
    const rows = transfer()
    carry(rows, ['/s/a.md'])

    expect(rows.effectAllowed).toBe('copyMove')
    expect(landing(drop(rows), 'win')).toBe('move')
  })

  test('copies them with Ctrl held, and with Alt on a Mac', () => {
    const rows = transfer()
    carry(rows, ['/s/a.md'])

    expect(landing(drop(rows, { ctrlKey: true }), 'win')).toBe('copy')
    expect(landing(drop(rows, { ctrlKey: true }), 'linux')).toBe('copy')
    expect(landing(drop(rows, { altKey: true }), 'mac')).toBe('copy')
    expect(landing(drop(rows, { ctrlKey: true }), 'mac')).toBe('move')
  })

  test('copies in files from outside the app, whatever is held', () => {
    const files = transfer(['Files'])

    expect(isFileDrop(files)).toBe(true)
    expect(landing(drop(files), 'win')).toBe('copy')
  })

  test('keeps a link dragged out of a page, and a picture as the file it carries', () => {
    const link = transfer(['text/uri-list', 'text/html', 'text/plain'])
    expect(isLinkDrop(link)).toBe(true)
    expect(landing(drop(link), 'win')).toBe('copy')

    const picture = transfer(['text/uri-list', 'text/html', 'Files'])
    expect(isLinkDrop(picture)).toBe(false)
    expect(isFileDrop(picture)).toBe(true)

    expect(isLinkDrop(transfer(['text/plain', 'text/html']))).toBe(false)
  })

  test('and takes nothing else', () => {
    expect(landing(drop(transfer(['text/plain'])), 'win')).toBeNull()
    expect(landing({ dataTransfer: null, ctrlKey: false, altKey: false }, 'win')).toBeNull()
  })
})

describe('a bookmark carried over the file list', () => {
  test('is a move where it is a tile, and nothing otherwise', async () => {
    const { carryBookmark, carriedNothing } = await import('./drag-paths')
    const tile = transfer()
    carryBookmark(tile, { kind: 'note', path: 'a.md', text: '' }, 0, true)
    expect(landing(drop(tile), 'linux')).toBe('move')
    carriedNothing()
    expect(landing(drop(tile), 'linux')).toBeNull()

    const search = transfer()
    carryBookmark(search, { kind: 'search', path: '', text: 'x' }, 1)
    expect(landing(drop(search), 'linux')).toBeNull()
  })
})

describe('rows of the file explorer, carried where files are taken', () => {
  test('are files to a place that takes them, even before the page may read the drag', () => {
    const rows = transfer()
    carryFromExplorer(rows, ['/home/me/Downloads/a.png', '/home/me/b.pdf'], false)
    expect(carriesFiles(rows)).toBe(true)
    expect(outsideRows(rows)).toEqual(['/home/me/Downloads/a.png', '/home/me/b.pdf'])

    const hidden = { types: rows.types, getData: () => '' } as unknown as DataTransfer
    expect(outsideRows(hidden)).toEqual(['/home/me/Downloads/a.png', '/home/me/b.pdf'])
    carriedNothing()
  })

  test('a note leaves PDFs alone, to open as page notes, and takes them along with other files', () => {
    const pdfs = transfer()
    carryFromExplorer(pdfs, ['/home/me/a.pdf', '/home/me/B.PDF'], false)
    expect(carriedIntoNotes.carries(pdfs)).toBe(false)
    expect(carriedIntoNotes.read(pdfs)).toBe(null)

    const mixed = transfer()
    carryFromExplorer(mixed, ['/home/me/a.pdf', '/home/me/b.png'], false)
    expect(carriedIntoNotes.carries(mixed)).toBe(true)
    carriedNothing()
  })

  test('rows inside the spaces are rows of the file list, not files from outside', () => {
    const rows = transfer()
    carryFromExplorer(rows, ['/s/Idea.md'], true)
    expect(outsideRows(rows)).toEqual([])
    expect(carriesFiles(rows)).toBe(false)
    expect(carriesFiles(transfer(['Files']))).toBe(true)
    expect(carriesFiles(transfer(['text/plain']))).toBe(false)
    carriedNothing()
  })
})

const MARKS: Bookmark[] = [
  { kind: 'note', path: 'a.md', text: '' },
  { kind: 'note', path: 'b.md', text: '' },
  { kind: 'note', path: 'c.md', text: '' },
]

describe('a bookmark carried', () => {
  test('is the bookmark picked up, not a place in a list', async () => {
    const here = await import('./drag-paths')
    const mark = transfer()
    here.carryBookmark(mark, MARKS[1]!, 1, true)

    expect(here.draggedBookmark(mark)).toBe(MARKS[1])
    expect(here.carriedMark()).toBe(MARKS[1])

    here.carriedNothing()
    expect(here.draggedBookmark(mark)).toBeNull()
    expect(here.carriedMark()).toBeNull()
  })
})

describe('a row carried by its place in a list', () => {
  test('is taken in the window it was picked up in', async () => {
    const here = await import('./drag-paths')

    const mark = transfer()
    here.carryBookmark(mark, MARKS[2]!, 2)
    expect(here.isBookmarkDrag(mark)).toBe(true)
    expect(here.draggedBookmark(mark)).toBe(MARKS[2])

    const section = transfer()
    here.carrySection(section, 3)
    expect(here.isSectionDrag(section)).toBe(true)
    expect(here.draggedSection(section)).toBe(3)

    const sheet = transfer()
    here.carryPage(sheet, { note: '/s/a.pages', page: 'p2' })
    expect(here.isPageDrag(sheet)).toBe(true)
    expect(here.draggedPage(sheet)).toEqual({ note: '/s/a.pages', page: 'p2' })
    here.carriedNothing()
  })

  test('and never in another window, whose list has other rows at those places', async () => {
    const there = await import('./drag-paths')
    const mark = transfer()
    there.carryBookmark(mark, MARKS[2]!, 2)
    const section = transfer()
    there.carrySection(section, 3)
    const sheet = transfer()
    there.carryPage(sheet, { note: '/s/a.pages', page: 'p2' })
    there.carriedNothing()

    vi.resetModules()
    const here = await import('./drag-paths')

    expect(here.isBookmarkDrag(mark)).toBe(false)
    expect(here.draggedBookmark(mark)).toBeNull()
    expect(here.isSectionDrag(section)).toBe(false)
    expect(here.draggedSection(section)).toBeNull()
    expect(here.isPageDrag(sheet)).toBe(false)
    expect(here.draggedPage(sheet)).toBeNull()
    expect(here.landing(drop(mark), 'linux')).toBeNull()
  })
})
