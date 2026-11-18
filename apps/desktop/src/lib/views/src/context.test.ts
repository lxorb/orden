import { answer, builtinView, cellValue, readBase, type Row } from '@orden/bases'
import { noteRowsOf } from '@orden/scan/rows'
import { describe, expect, test, vi } from 'vitest'
import { linearly } from '../../../../../../scripts/growth'

const signed: { name: string | null } = vi.hoisted(() => ({ name: 'Emil' }))
vi.mock('../../accounts/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../accounts/src/api')>()),
  account: {
    get name() {
      return signed.name
    },
  },
}))

const { contextFor } = await import('./context')

const rows = noteRowsOf(
  'Mine',
  'Errands.md',
  '- [ ] Mine [assignee:: Emil]\n- [ ] Also mine [assignee:: emil]\n- [ ] Theirs [assignee:: Ada]\n- [ ] Nobody’s\n',
)

const assigned = () =>
  answer(
    builtinView('assigned'),
    0,
    rows,
    contextFor({ rows, today: '2026-11-06', now: '2026-11-06T10:00' }),
  ).groups.flatMap((group) => group.rows.map((row) => row.task?.text))

describe('a view’s tasks assigned to me (#1254)', () => {
  test('are the ones assigned to the signed-in reader, whatever the capitals', () => {
    signed.name = 'Emil'
    expect(assigned()).toEqual(['Mine', 'Also mine'])
  })

  test('are none while nobody is signed in', () => {
    signed.name = null
    expect(assigned()).toEqual([])
  })
})

test('the notes that link to a note are gathered in time that grows with the notes, however many link to one', () => {
  const index = noteRowsOf('Mine', 'Index.md', '# Index\n')
  const days = new Map<number, ReturnType<typeof noteRowsOf>>()
  const daily = (count: number) => {
    const known = days.get(count)
    if (known) return known
    const made = [
      ...index,
      ...Array.from({ length: count }, (_, at) =>
        noteRowsOf('Mine', `Day ${at}.md`, 'See [[Index]]\n'),
      ).flat(),
    ]
    days.set(count, made)
    return made
  }
  const target = index.find((one) => one.kind === 'note')
  if (!target) throw new Error('no note row')
  const linking = linearly(
    (count) =>
      contextFor({
        rows: daily(count),
        today: '2026-11-06',
        now: '2026-11-06T10:00',
      }).backlinks?.(target),
    16_000,
  )
  expect(linking).toHaveLength(16_000)
})

describe('a link in a base', () => {
  const rows = [
    ...noteRowsOf('Mine', 'Plan.md', '# Top plan\n'),
    ...noteRowsOf('Mine', 'Work/Plan.md', '# Work plan\n'),
    ...noteRowsOf('Mine', 'Work/Journal.md', 'See [[Plan]]\n'),
    ...noteRowsOf('Mine', 'Other.md', 'See [[Work/Plan]]\n'),
    ...noteRowsOf('Mine', 'Work/Notes.md', 'See [the plan](../Plan.md)\n'),
  ]
  const note = (path: string) => {
    const found = rows.find((one) => one.kind === 'note' && one.path === path)
    if (!found) throw new Error(`no row for ${path}`)
    return found
  }
  const context = contextFor({ rows, today: '2026-11-06', now: '2026-11-06T10:00' })

  test('reaches the namesake the editor opens, not the first note of that name', () => {
    expect(context.resolve?.('Plan', note('Work/Journal.md'))).toBe('Work/Plan.md')
    expect(context.resolve?.('Work/Plan', note('Other.md'))).toBe('Work/Plan.md')
    expect(context.resolve?.('Plan', note('Other.md'))).toBe('Plan.md')
    expect(context.resolve?.('../Plan.md', note('Work/Notes.md'))).toBe('Plan.md')
  })

  test('counts as a backlink of the note it reaches', () => {
    expect(context.backlinks?.(note('Work/Plan.md'))).toEqual(['Work/Journal.md', 'Other.md'])
    expect(context.backlinks?.(note('Plan.md'))).toEqual(['Work/Notes.md'])
  })
})

describe('the links a base follows', () => {
  const build = (files: Record<string, string>) => {
    const rows = Object.entries(files).flatMap(([path, text]) => noteRowsOf('Mine', path, text))
    const note = (path: string) => {
      const found = rows.find((one) => one.kind === 'note' && one.path === path)
      if (!found) throw new Error(`no row for ${path}`)
      return found
    }
    return { note, context: contextFor({ rows, today: '2026-11-06', now: '2026-11-06T10:00' }) }
  }
  const formula = (source: string) =>
    readBase(`formulas:\n  it: ${source}\nviews:\n  - type: table\n    name: T\n`)

  test('reach a backlink’s own note, not a namesake beside the row', () => {
    const { note, context } = build({
      'Projects/Alpha.md': '# Alpha\n',
      'Projects/Kickoff.md': '# unrelated\n',
      'Kickoff.md': '---\nproject: "[[Alpha]]"\n---\n',
    })
    const alpha = note('Projects/Alpha.md')
    expect(
      cellValue(
        formula('file.backlinks.map(value.asFile().file.path)'),
        'formula.it',
        alpha,
        context,
      ),
    ).toEqual(['Kickoff.md'])
    expect(
      cellValue(
        formula('file.backlinks.filter(list(value.asFile().properties.project).contains(file))'),
        'formula.it',
        alpha,
        context,
      ),
    ).toHaveLength(1)
  })

  test('reach a note by its alias, as the editor does', () => {
    const { note, context } = build({
      'Plan.md': '---\naliases: [Roadmap]\n---\n',
      'A.md': 'See [[Roadmap]]\n',
    })
    expect(
      cellValue(formula('file.hasLink(link("Plan"))'), 'formula.it', note('A.md'), context),
    ).toBe(true)
    expect(context.backlinks?.(note('Plan.md'))).toEqual(['A.md'])
  })

  test('count a note that links twice as one backlink', () => {
    const { note, context } = build({
      'Plan.md': '',
      'A.md': 'See [[Plan]], then [[Plan#Goals]]\n',
    })
    expect(context.backlinks?.(note('Plan.md'))).toEqual(['A.md'])
  })

  test('are gathered in time that grows with the notes, however many share a name', () => {
    const made = new Map<number, Row[]>()
    const rowsFor = (count: number) => {
      const known = made.get(count)
      if (known) return known
      const rows = Array.from({ length: count }, (_, at) =>
        noteRowsOf('Mine', `Project ${at}/Index.md`, 'See [[Index]]\n'),
      ).flat()
      made.set(count, rows)
      return rows
    }
    const linking = linearly((count) => {
      const rows = rowsFor(count)
      const first = rows[0]
      if (!first) throw new Error('no rows')
      return contextFor({ rows, today: '2026-11-06', now: '2026-11-06T10:00' }).backlinks?.(first)
    }, 2000)
    expect(linking).toEqual(['Project 0/Index.md'])
  })
})
