import { answer, builtinView } from '@orden/bases'
import { rowsOfText } from '@orden/bases/rows'
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

const rows = rowsOfText(
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

describe('the notes that link to a note', () => {
  test('are gathered in time that grows with the notes, however many link to one', () => {
    const index = rowsOfText('Mine', 'Index.md', '# Index\n')
    const days = new Map<number, ReturnType<typeof rowsOfText>>()
    const daily = (count: number) => {
      const known = days.get(count)
      if (known) return known
      const made = [
        ...index,
        ...Array.from({ length: count }, (_, at) =>
          rowsOfText('Mine', `Day ${at}.md`, 'See [[Index]]\n'),
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
})

describe('a link in a base', () => {
  const rows = [
    ...rowsOfText('Mine', 'Plan.md', '# Top plan\n'),
    ...rowsOfText('Mine', 'Work/Plan.md', '# Work plan\n'),
    ...rowsOfText('Mine', 'Work/Journal.md', 'See [[Plan]]\n'),
    ...rowsOfText('Mine', 'Other.md', 'See [[Work/Plan]]\n'),
    ...rowsOfText('Mine', 'Work/Notes.md', 'See [the plan](../Plan.md)\n'),
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
