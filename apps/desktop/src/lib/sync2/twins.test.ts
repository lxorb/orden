import { describe, expect, test } from 'vitest'
import { linearly } from '../../../../../scripts/growth'
import { SpaceState } from './places'
import type { EntryRow } from './store'
import { madeTwice } from './twins'

function row(id: string, name: string, local: string, hash: string, deleted = false): EntryRow {
  return {
    id,
    space_id: 's',
    kind: 'file',
    parent: null,
    name,
    local_path: local,
    file_key: hash,
    written_hash: hash,
    mtime: null,
    size: null,
    seq: 1,
    deleted,
  }
}

function space(rows: EntryRow[]) {
  return new SpaceState(
    { space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null },
    rows,
    [],
    'd',
    { platform: 'linux', foldsCase: true } as never,
  )
}

describe('a file sync numbered beside itself (#1904)', () => {
  test('goes back to its own name when the entry it was made twice as is gone with the same bytes', () => {
    expect(
      madeTwice(
        space([
          row('a', 'GIMP.application', '', 'h1', true),
          row('b', 'GIMP 2.application', 'GIMP 2.application', 'h1'),
          row('c', 'Photo.png', '', 'p1', true),
          row('d', 'Photo 2.png', 'Photo 2.png', 'p1'),
        ]),
      ),
    ).toEqual([
      { from: 'GIMP 2.application', to: 'GIMP.application' },
      { from: 'Photo 2.png', to: 'Photo.png' },
    ])
  })

  test('keeps a numbered name the reader chose, other bytes, or a name already taken', () => {
    expect(madeTwice(space([row('b', 'Plan 2.pdf', 'Plan 2.pdf', 'h1')]))).toEqual([])
    expect(
      madeTwice(
        space([row('a', 'Plan.pdf', '', 'old', true), row('b', 'Plan 2.pdf', 'Plan 2.pdf', 'new')]),
      ),
    ).toEqual([])
    expect(
      madeTwice(
        space([
          row('a', 'Plan.pdf', '', 'h1', true),
          row('b', 'Plan 2.pdf', 'Plan 2.pdf', 'h1'),
          row('c', 'Plan.pdf', 'Plan.pdf', 'h2'),
        ]),
      ),
    ).toEqual([])
  })

  test('looks over a folder of many numbered files in time that grows with it, not its square', () => {
    const many = linearly((size) => {
      const rows = [row('gone', 'Photo.png', '', 'h0', true)]
      for (let at = 1; at <= size; at++) {
        const name = `Photo ${String(at)}.png`
        rows.push(row(`p${String(at)}`, name, name, `h${String(at)}`))
        rows.push(row(`d${String(at)}`, `Scan ${String(at)}.png`, '', `s${String(at)}`, true))
      }
      return madeTwice(space(rows))
    }, 4000)
    expect(many).toEqual([])
  })
})
