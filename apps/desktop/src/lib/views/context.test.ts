import { answer, builtinView } from '@orden/bases'
import { rowsOfText } from '@orden/bases/rows'
import { describe, expect, test, vi } from 'vitest'
import { linearly } from '../../../../../scripts/growth'

const signed: { name: string | null } = vi.hoisted(() => ({ name: 'Emil' }))
vi.mock('../account.svelte', () => ({
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
