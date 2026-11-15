import { cellValue, readBase } from '@orden/bases'
import { describe, expect, test } from 'vitest'
import { noteRow } from './fixture'
import { barOf, dragged } from './timeline'

const base = readBase('views:\n  - type: timeline\n    name: T\n')
const context = { today: '2026-01-05', now: '2026-01-05T09:00:00' }

describe('a timeline bar moved by days', () => {
  test('keeps a time on the hour as a time', () => {
    const row = noteRow('a.md', 'start: 2026-01-05T10:00\nend: 2026-01-07T18:30:00')
    const bar = barOf(row, { start: 'note.start', end: 'note.end' }, (one, property) =>
      cellValue(base, property, one, context),
    )
    if (!bar) throw new Error('no bar')
    expect(dragged(bar, 'move', 2)).toEqual({
      'note.start': '2026-01-07T10:00',
      'note.end': '2026-01-09T18:30',
    })
  })

  test('keeps a time written in UTC with its Z, so it still reads as a date', () => {
    const row = noteRow('a.md', 'start: 2026-01-07T10:00:00Z\nend: 2026-01-07T18:30:00+02:00')
    const bar = barOf(row, { start: 'note.start', end: 'note.end' }, (one, property) =>
      cellValue(base, property, one, context),
    )
    if (!bar) throw new Error('no bar')
    expect(dragged(bar, 'move', 2)).toEqual({
      'note.start': '2026-01-09T10:00Z',
      'note.end': '2026-01-09T18:30+02:00',
    })
  })
})
