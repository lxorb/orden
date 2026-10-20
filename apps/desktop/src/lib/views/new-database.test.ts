import { answer, groupName, readBase } from '@nib/bases'
import { describe, expect, test } from 'vitest'
import { noteRow } from './fixture'
import { databaseNote } from './new-database'

describe('a new database', () => {
  const words = databaseNote()
  const base = readBase(words.replace(/^```base\n/, '').replace(/```\n$/, ''))
  const own = noteRow('Plans/Plans.md', '')
  const rows = [
    own,
    noteRow('Plans/Ship.md', 'status: Done'),
    noteRow('Plans/Write.md', 'status: In progress'),
    noteRow('Plans/Idea.md', ''),
    noteRow('Other/Else.md', 'status: Done'),
  ]

  test('is a board over the notes beside its own note, and not that note', () => {
    const shown = answer(base, 0, rows, {
      today: '2026-10-19',
      now: '2026-10-19T09:00:00',
      this: own,
    })
    const names = shown.groups.flatMap((group) => group.rows.map((row) => row.file.basename))
    expect(names.sort()).toEqual(['Idea', 'Ship', 'Write'])
  })

  test('opens on its status, the column of no status first, medium cards', () => {
    const shown = answer(base, 0, rows, {
      today: '2026-10-19',
      now: '2026-10-19T09:00:00',
      this: own,
    })
    expect(shown.groups.map((group) => groupName(group.key))).toEqual([
      '',
      'Not started',
      'In progress',
      'Done',
    ])
    expect(base.views[0]?.type).toBe('kanban')
    expect(base.views[0]?.nib.cardSize).toBe('medium')
    expect(base.nib.properties.status?.options?.map((one) => one.tone)).toEqual([
      undefined,
      '5',
      '4',
    ])
  })
})
