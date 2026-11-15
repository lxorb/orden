import { expect, test } from 'vitest'
import { answer, readBase } from './index'
import { linkContext } from './link-context'
import { rowsOf } from './note-rows'
import type { Row } from './types'

const note = (path: string, front: string | null, links: string[] = []) =>
  rowsOf('S', {
    path,
    front,
    tasks: [],
    stamp: null,
    tags: [],
    links: links.map((target) => ({ target, embed: false })),
  })

const paths = (base: ReturnType<typeof readBase>, rows: Row[], self?: Row) =>
  answer(base, 0, rows, {
    today: '2026-11-15',
    now: '2026-11-15T10:00',
    ...linkContext(rows),
    ...(self ? { this: self } : {}),
  }).groups.flatMap((group) => group.rows.map((row) => row.path))

const filtered = (filter: string) => `filters: '${filter}'\nviews:\n  - type: table\n    name: T\n`

test('a view filtered by a link follows the notes made after its first answer', () => {
  const yaml = filtered('file.hasLink("Projects/Alpha")')
  const base = readBase(yaml)
  const day = note('Journal/Day.md', null, ['Alpha'])
  expect(paths(base, day)).toEqual([])
  const after = [...day, ...note('Projects/Alpha.md', null)]
  expect(paths(base, after)).toEqual(['Journal/Day.md'])
})

test('a view comparing a link follows a namesake made after its first answer', () => {
  const base = readBase(filtered('note.parent == link("Sub/Plan")'))
  const child = note('A/Child.md', 'parent: "[[Plan]]"')
  const plan = note('A/Sub/Plan.md', null)
  expect(paths(base, [...child, ...plan])).toEqual(['A/Child.md'])
  expect(paths(base, [...child, ...plan, ...note('A/Plan.md', null)])).toEqual([])
})

test.each(['this.file.links.contains(file)', 'note.project == this.project'])(
  'an embedded view filtered by %s follows edits to the note it sits in',
  (filter) => {
    const others = [...note('A.md', 'project: x'), ...note('B.md', 'project: y')]
    const before = note('Hub.md', 'project: x', ['A'])
    const after = note('Hub.md', 'project: y', ['A', 'B'])
    const base = readBase(filtered(filter))
    paths(base, [...others, ...before], before[0])
    expect(paths(base, [...others, ...after], after[0])).toEqual(
      paths(readBase(filtered(filter)), [...others, ...after], after[0]),
    )
  },
)

test.each(['file.links.contains(this.file)', 'note.parent == this'])(
  'a view filtered by %s follows a namesake made beside a linking note',
  (filter) => {
    const alpha = note('Projects/Alpha.md', null)
    const before = [...note('Journal/Day.md', 'parent: "[[Alpha]]"', ['Alpha']), ...alpha]
    const after = [...before, ...note('Journal/Alpha.md', null)]
    const base = readBase(filtered(filter))
    expect(paths(base, before, alpha[0])).toEqual(['Journal/Day.md'])
    expect(paths(base, after, alpha[0])).toEqual([])
  },
)
