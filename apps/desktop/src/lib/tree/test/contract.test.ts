import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Entry } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import {
  entryAt,
  flatRows,
  folderNote,
  orderedTree,
  rowIds,
  withEntry,
  withMove,
  withoutEntry,
} from '../src/api'

const SRC = join(import.meta.dirname, '../src')

const file = (path: string, modified = 0): Entry => ({
  name: path.split('/').at(-1) ?? path,
  path,
  is_dir: false,
  modified,
  created: modified,
  children: [],
})

const folder = (path: string, children: Entry[]): Entry => ({
  ...file(path),
  is_dir: true,
  children,
})

const space = (): Entry =>
  folder('/s', [
    file('/s/b.md', 2),
    folder('/s/Trip', [file('/s/Trip/Trip.md'), file('/s/Trip/plan.md')]),
    file('/s/a.md', 1),
  ])

test('the module stands on its own reaches no app module but the platform, the file ops and what a space keeps', () => {
  const reached = readdirSync(SRC)
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    .flatMap((name) =>
      [...readFileSync(join(SRC, name), 'utf8').matchAll(/from '(\.\.[^']*)'/g)].map(
        (found) => found[1],
      ),
    )
  expect([...new Set(reached)].sort()).toEqual([
    '../../file-ops/src/api',
    '../../platform/src/api',
    '../../space-kept/src/api',
  ])
})

describe('the tree of a space', () => {
  test('is ordered by name with folders first, and kept as it was when nothing moves', () => {
    const tree = space()
    const ordered = orderedTree(tree, 'name', () => [])
    expect(ordered.children.map((one) => one.name)).toEqual(['Trip', 'a.md', 'b.md'])
    expect(orderedTree(ordered, 'name', () => [])).toBe(ordered)
  })

  test('takes a new entry, a move and a removal without changing the tree it was given', () => {
    const tree = space()
    const added = withEntry(tree, file('/s/Trip/map.md'))
    expect(entryAt(added, '/s/Trip/map.md')?.name).toBe('map.md')
    expect(entryAt(tree, '/s/Trip/map.md')).toBeNull()
    const moved = withMove(added, '/s/a.md', '/s/Trip/a.md')
    expect(entryAt(moved, '/s/Trip/a.md')).not.toBeNull()
    expect(entryAt(moved, '/s/a.md')).toBeNull()
    expect(entryAt(withoutEntry(moved, '/s/Trip'), '/s/Trip/plan.md')).toBeNull()
  })

  test('shows a folder note as its folder, and lists the rest when the folder is open', () => {
    const tree = orderedTree(space(), 'name', () => [])
    const trip = entryAt(tree, '/s/Trip')
    expect(trip && folderNote(trip)?.path).toBe('/s/Trip/Trip.md')
    const rows = flatRows(tree, (path) => path === '/s/Trip').map((row) => row.entry.path)
    expect(rows).toEqual(['/s/Trip', '/s/Trip/plan.md', '/s/a.md', '/s/b.md'])
  })

  test('gives every row an id that follows it through a move', () => {
    const id = rowIds.idOf('/s/Trip/plan.md')
    expect(rowIds.idOf('/s/Trip/plan.md')).toBe(id)
    rowIds.moved('/s/Trip', '/s/Away')
    expect(rowIds.peek('/s/Away/plan.md')).toBe(id)
    rowIds.gone('/s/Away')
    expect(rowIds.peek('/s/Away/plan.md')).toBeUndefined()
  })
})
