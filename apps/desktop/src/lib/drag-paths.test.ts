import { describe, expect, test } from 'vitest'
import {
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
    carryBookmark(tile, 0, true)
    expect(landing(drop(tile), 'linux')).toBe('move')
    carriedNothing()
    expect(landing(drop(tile), 'linux')).toBeNull()

    const search = transfer()
    carryBookmark(search, 1)
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
