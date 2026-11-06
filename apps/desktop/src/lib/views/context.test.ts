import { answer, builtinView } from '@orden/bases'
import { rowsOfText } from '@orden/bases/rows'
import { describe, expect, test, vi } from 'vitest'

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
