import { describe, expect, test } from 'vitest'
import { anyOpen, flatRows, heldRows, rowIndex, standsOpen } from './tree-flat'
import type { Entry } from './workspace.svelte'

const file = (path: string): Entry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  is_dir: false,
  modified: 0,
  created: 0,
  children: [],
})

const folder = (path: string, children: Entry[]): Entry => ({
  ...file(path),
  is_dir: true,
  children,
})

const WORK = folder('/s/Work', [
  file('/s/Work/Work.md'),
  folder('/s/Work/Notes', [file('/s/Work/Notes/Notes.md'), file('/s/Work/Notes/deep.md')]),
  file('/s/Work/plan.md'),
])
const PROJECTS = folder('/s/Projects', [file('/s/Projects/one.md')])
const READ_ME = file('/s/Read me.md')

const SPACE = folder('/s', [WORK, PROJECTS, READ_ME])

const open = (...paths: string[]) => {
  const held = new Set(paths)
  return (path: string) => held.has(path)
}

const shown = (...paths: string[]) =>
  flatRows(SPACE, open(...paths)).map((one) => `${'  '.repeat(one.depth)}${one.entry.path}`)

describe('the file list as one flat list of rows', () => {
  test('shows the top of the space while nothing is open', () => {
    expect(shown()).toEqual(['/s/Work', '/s/Projects', '/s/Read me.md'])
  })

  test('and never the note a row is itself drawn as', () => {
    expect(shown('/s/Work')).toEqual([
      '/s/Work',
      '  /s/Work/Notes',
      '  /s/Work/plan.md',
      '/s/Projects',
      '/s/Read me.md',
    ])
  })

  test('one step in per note that holds the one under it', () => {
    expect(shown('/s/Work', '/s/Work/Notes')).toEqual([
      '/s/Work',
      '  /s/Work/Notes',
      '    /s/Work/Notes/deep.md',
      '  /s/Work/plan.md',
      '/s/Projects',
      '/s/Read me.md',
    ])
  })

  test('and a folder nobody has written in shows all of what it holds', () => {
    expect(shown('/s/Projects')).toEqual([
      '/s/Work',
      '/s/Projects',
      '  /s/Projects/one.md',
      '/s/Read me.md',
    ])
  })

  test('a shut note holds nothing open, however deep it goes', () => {
    expect(shown('/s/Work/Notes')).toEqual(['/s/Work', '/s/Projects', '/s/Read me.md'])
  })

  test('and a space nobody has listed yet is no rows at all', () => {
    expect(flatRows(null, open())).toEqual([])
  })

  test('a note at the top of the space is a row whatever it is called', () => {
    const top = folder('/s/Notes', [
      file('/s/Notes/Index.md'),
      file('/s/Notes/Notes.md'),
      file('/s/Notes/plan.md'),
    ])

    expect(flatRows(top, open()).map((one) => one.entry.path)).toEqual([
      '/s/Notes/Index.md',
      '/s/Notes/Notes.md',
      '/s/Notes/plan.md',
    ])
  })
})

describe('how many rows a note holds open', () => {
  test('counts what the row discloses and not the note it is drawn as', () => {
    expect(heldRows(WORK, open('/s/Work'))).toBe(2)
  })

  test('and everything under it that is open too', () => {
    expect(heldRows(WORK, open('/s/Work', '/s/Work/Notes'))).toBe(3)
  })

  test('nothing for a row that holds nothing', () => {
    expect(heldRows(READ_ME, open())).toBe(0)
  })
})

describe('where each row is', () => {
  test('is the number the window and the walk both speak in', () => {
    const at = rowIndex(flatRows(SPACE, open('/s/Work')))

    expect(at.get('/s/Work')).toBe(0)
    expect(at.get('/s/Work/plan.md')).toBe(2)
    expect(at.get('/s/Read me.md')).toBe(4)
    expect(at.get('/s/Work/Work.md')).toBeUndefined()
  })
})

describe('a row that stands open', () => {
  const LEAF = folder('/s/Lone', [file('/s/Lone/Lone.md')])
  const EMPTY = folder('/s/Empty', [])
  const WITH_LEAVES = folder('/s', [LEAF, EMPTY, PROJECTS])

  test('is a note that holds rows, its twist turned', () => {
    expect(standsOpen(WORK, open('/s/Work'))).toBe(true)
    expect(standsOpen(WORK, open())).toBe(false)
  })

  test('and never one that holds nothing, whatever is remembered', () => {
    expect(standsOpen(LEAF, open('/s/Lone'))).toBe(false)
    expect(standsOpen(EMPTY, open('/s/Empty'))).toBe(false)
    expect(standsOpen(READ_ME, open('/s/Read me.md'))).toBe(false)
  })

  test('so a list of rows that hold nothing has nothing to fold', () => {
    expect(anyOpen(WITH_LEAVES, open('/s/Lone', '/s/Empty'))).toBe(false)
    expect(anyOpen(WITH_LEAVES, open('/s/Projects'))).toBe(true)
  })

  test('nor one whose open rows are all under a row that is shut', () => {
    expect(anyOpen(SPACE, open('/s/Work/Notes'))).toBe(false)
    expect(anyOpen(SPACE, open('/s/Work', '/s/Work/Notes'))).toBe(true)
  })

  test('nor one that remembers a row the list no longer has', () => {
    expect(anyOpen(SPACE, open('/s/Gone', '/s/Work/Gone'))).toBe(false)
    expect(anyOpen(null, open('/s/Work'))).toBe(false)
  })

  test('and a row with nothing under it adds no rows when it is remembered open', () => {
    expect(flatRows(WITH_LEAVES, open('/s/Lone')).map((one) => one.entry.path)).toEqual([
      '/s/Lone',
      '/s/Empty',
      '/s/Projects',
    ])
  })
})
