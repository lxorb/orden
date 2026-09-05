import { describe, expect, test } from 'vitest'
import type { Entry, TreeOptions } from './workspace.svelte'
import { entryAt, withEntry, withMove, withoutEntry } from './tree-edits'

const BY_NAME: TreeOptions = { showHidden: false, sort: 'name', descending: false }

function file(path: string): Entry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  }
}

function folder(path: string, children: Entry[] = []): Entry {
  return { ...file(path), is_dir: true, children }
}

function root(): Entry {
  return folder('/N', [
    folder('/N/Deep', [file('/N/Deep/inner.md')]),
    file('/N/a.md'),
    file('/N/c.md'),
  ])
}

/** The tree as paths, so a whole shape reads in one line. */
function shape(entry: Entry): string[] {
  return entry.children.flatMap((child) => [child.path, ...shape(child)])
}

describe('a row put into the tree before the disk answers', () => {
  test('lands where the listing would put it', () => {
    expect(shape(withEntry(root(), file('/N/b.md'), BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/b.md',
      '/N/c.md',
    ])
  })

  test('a folder goes above the notes, whatever its name', () => {
    expect(shape(withEntry(root(), folder('/N/zzz'), BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/zzz',
      '/N/a.md',
      '/N/c.md',
    ])
  })

  test('descending order is followed too', () => {
    // The tree on show is already in the order it was listed in, so a
    // descending one is what a descending insert has to fit into.
    const down = { ...BY_NAME, descending: true }
    const listed = folder('/N', [file('/N/c.md'), file('/N/a.md')])
    expect(shape(withEntry(listed, file('/N/b.md'), down))).toEqual([
      '/N/c.md',
      '/N/b.md',
      '/N/a.md',
    ])
  })

  test('inside a folder, not at the top', () => {
    expect(shape(withEntry(root(), file('/N/Deep/also.md'), BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/also.md',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/c.md',
    ])
  })

  test('a row that is already there is not doubled', () => {
    expect(shape(withEntry(root(), file('/N/a.md'), BY_NAME))).toEqual(shape(root()))
  })

  test('the tree it was given is left alone', () => {
    const before = root()
    withEntry(before, file('/N/b.md'), BY_NAME)
    expect(shape(before)).toEqual(shape(root()))
  })
})

describe('a row taken out before the disk answers', () => {
  test('goes, and nothing else moves', () => {
    expect(shape(withoutEntry(root(), '/N/a.md'))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/c.md',
    ])
  })

  test('a folder takes its contents with it', () => {
    expect(shape(withoutEntry(root(), '/N/Deep'))).toEqual(['/N/a.md', '/N/c.md'])
  })

  test('a row inside a folder', () => {
    expect(shape(withoutEntry(root(), '/N/Deep/inner.md'))).toEqual([
      '/N/Deep',
      '/N/a.md',
      '/N/c.md',
    ])
  })
})

describe('a row renamed or moved before the disk answers', () => {
  test('a rename re-sorts it', () => {
    expect(shape(withMove(root(), '/N/a.md', '/N/z.md', BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/c.md',
      '/N/z.md',
    ])
  })

  test('a move into a folder takes the row there', () => {
    expect(shape(withMove(root(), '/N/c.md', '/N/Deep/c.md', BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/c.md',
      '/N/Deep/inner.md',
      '/N/a.md',
    ])
  })

  test('a folder takes its contents along, paths and all', () => {
    const moved = withMove(root(), '/N/Deep', '/N/Shallow', BY_NAME)
    expect(shape(moved)).toEqual([
      '/N/Shallow',
      '/N/Shallow/inner.md',
      '/N/a.md',
      '/N/c.md',
    ])
    expect(entryAt(moved, '/N/Shallow/inner.md')?.name).toBe('inner.md')
  })

  test('a row that is not there changes nothing', () => {
    expect(shape(withMove(root(), '/N/missing.md', '/N/b.md', BY_NAME))).toEqual(shape(root()))
  })

  test('the new name is the one shown', () => {
    expect(entryAt(withMove(root(), '/N/a.md', '/N/z.md', BY_NAME), '/N/z.md')?.name).toBe('z.md')
  })
})

describe('finding a row', () => {
  test('at the top, deep down, and not at all', () => {
    expect(entryAt(root(), '/N/a.md')?.path).toBe('/N/a.md')
    expect(entryAt(root(), '/N/Deep/inner.md')?.path).toBe('/N/Deep/inner.md')
    expect(entryAt(root(), '/N/nope.md')).toBeNull()
    expect(entryAt(null, '/N/a.md')).toBeNull()
  })
})
