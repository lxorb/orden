import { beforeEach, describe, expect, test } from 'vitest'
import { outermost, Selection } from './selection.svelte'

/** The rows as the tree shows them, top to bottom, with the folder open. */
const ROWS = ['/a.md', '/f', '/f/b.md', '/f/c.md', '/d.md']

let picked: Selection

beforeEach(() => {
  picked = new Selection()
})

describe('picking rows', () => {
  test('a plain click takes that row alone', () => {
    picked.select('/a.md')
    picked.select('/d.md')
    expect(picked.paths).toEqual(['/d.md'])
  })

  test('ctrl adds and removes, leaving the rest alone', () => {
    picked.select('/a.md')
    picked.toggle('/d.md')
    expect(picked.paths).toEqual(['/a.md', '/d.md'])

    picked.toggle('/a.md')
    expect(picked.paths).toEqual(['/d.md'])
  })

  test('shift takes everything between the last plain click and here', () => {
    picked.select('/a.md')
    picked.range('/f/c.md', ROWS)
    expect(picked.paths).toEqual(['/a.md', '/f', '/f/b.md', '/f/c.md'])
  })

  test('shift back the other way narrows rather than growing', () => {
    picked.select('/f/c.md')
    picked.range('/a.md', ROWS)
    expect(picked.paths).toEqual(['/a.md', '/f', '/f/b.md', '/f/c.md'])
  })

  test('shift with no anchor picks the row alone', () => {
    picked.range('/d.md', ROWS)
    expect(picked.paths).toEqual(['/d.md'])
  })

  test('a row that is no longer shown is not an anchor either', () => {
    picked.select('/f/b.md')
    // The folder was closed, so its children are no longer between anything.
    picked.range('/d.md', ['/a.md', '/f', '/d.md'])
    expect(picked.paths).toEqual(['/d.md'])
  })

  test('ctrl moves the anchor to the row it just touched', () => {
    picked.select('/a.md')
    picked.toggle('/f/b.md')
    picked.range('/f/c.md', ROWS)
    expect(picked.paths).toEqual(['/f/b.md', '/f/c.md'])
  })
})

describe('what a drag carries', () => {
  test('the whole selection when the row is part of it', () => {
    picked.select('/a.md')
    picked.toggle('/d.md')
    expect(picked.dragging('/a.md')).toEqual(['/a.md', '/d.md'])
  })

  test('the row alone otherwise, selection or not', () => {
    picked.select('/a.md')
    expect(picked.dragging('/f')).toEqual(['/f'])
    // One picked row is not a group, so dragging it carries only itself.
    expect(picked.dragging('/a.md')).toEqual(['/a.md'])
  })
})

describe('rows that have gone away', () => {
  test('take themselves out', () => {
    picked.all(ROWS)
    picked.keepOnly((path) => path !== '/f/b.md')
    expect(picked.paths).toEqual(['/a.md', '/f', '/f/c.md', '/d.md'])
  })
})

describe('the outermost of a set of rows', () => {
  test('leaves out what a folder already takes along', () => {
    expect(outermost(['/f', '/f/b.md', '/a.md'])).toEqual(['/f', '/a.md'])
  })

  test('keeps a name that merely starts the same way', () => {
    expect(outermost(['/f', '/fee.md'])).toEqual(['/f', '/fee.md'])
  })
})
