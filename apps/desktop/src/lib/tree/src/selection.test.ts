import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { outermost, Selection } from './selection.svelte'

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

  test('shift and an arrow stretch from the row the keyboard is on', () => {
    picked.select('/a.md')
    picked.extend('/a.md', '/f', ROWS)
    picked.extend('/f', '/f/b.md', ROWS)
    expect(picked.paths).toEqual(['/a.md', '/f', '/f/b.md'])

    picked.extend('/f/b.md', '/f', ROWS)
    expect(picked.paths).toEqual(['/a.md', '/f'])
  })

  test('and start again from where the arrows walked to', () => {
    picked.select('/a.md')
    picked.extend('/f/c.md', '/d.md', ROWS)
    expect(picked.paths).toEqual(['/f/c.md', '/d.md'])
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

  test('leaves out a row several folders down, and the folders between', () => {
    expect(outermost(['/f', '/f/g', '/f/g/h', '/f/g/h/i.md', '/a.md'])).toEqual(['/f', '/a.md'])
  })

  test('keeps the deeper row where the folder above it is not picked', () => {
    expect(outermost(['/f/g/h.md', '/a.md'])).toEqual(['/f/g/h.md', '/a.md'])
  })
})

describe('what asking costs', () => {
  const DEEP = 3
  const MANY = 500

  function manyRows(): string[] {
    return Array.from({ length: MANY }, (_, at) => `/a/b/c/note-${at}.md`)
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('asking whether a row is picked does not walk the selection', () => {
    const rows = manyRows()
    picked.all(rows)

    const walked = vi.spyOn(Array.prototype, 'includes')
    const answers = rows.map((path) => picked.has(path))
    const missing = picked.has('/nowhere.md')
    const calls = walked.mock.calls.length
    walked.mockRestore()

    expect(answers.every((one) => one)).toBe(true)
    expect(missing).toBe(false)
    expect(calls).toBe(0)
  })

  test('the outermost rows are looked up rather than compared with each other', () => {
    const rows = manyRows()

    const compared = vi.spyOn(String.prototype, 'startsWith')
    const kept = outermost(rows)
    const calls = compared.mock.calls.length
    compared.mockRestore()

    expect(kept).toHaveLength(MANY)
    expect(calls).toBe(0)
    expect(rows[0]?.split('/').length).toBe(DEEP + 2)
  })
})

describe('rows that move under the selection', () => {
  test('stay picked under their new paths, a folder taking what is in it', () => {
    picked.select('/f/b.md')
    picked.toggle('/d.md')
    picked.moved('/f', '/g')
    picked.moved('/d.md', '/e.md')
    expect(picked.paths).toEqual(['/g/b.md', '/e.md'])

    picked.range('/a.md', ['/a.md', '/g', '/g/b.md', '/g/c.md', '/e.md'])
    expect(picked.paths).toEqual(['/a.md', '/g', '/g/b.md', '/g/c.md', '/e.md'])
  })

  test('and a row deleted elsewhere leaves it, with what was inside', () => {
    picked.select('/f/b.md')
    picked.toggle('/a.md')
    picked.gone('/f')
    expect(picked.paths).toEqual(['/a.md'])
  })
})
