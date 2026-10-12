import { describe, expect, test } from 'vitest'
import type { Row } from '@nib/bases'
import { taskRowsOfText } from '@nib/bases/tasks'
import {
  changeFor,
  loadByDay,
  quickDays,
  repeatKindOf,
  repeatRule,
  REPEATS,
  typedWhen,
} from './schedule'

// Monday 12 October 2026, at ten in the morning.
const NOW = new Date(2026, 9, 12, 10, 0)

describe('the scheduler', () => {
  test('offers Todoist’s days, the ones a weekday still has', () => {
    expect(quickDays('2026-10-12')).toEqual([
      { kind: 'today', day: '2026-10-12' },
      { kind: 'tomorrow', day: '2026-10-13' },
      { kind: 'later', day: '2026-10-14' },
      { kind: 'weekend', day: '2026-10-17' },
      { kind: 'next-week', day: '2026-10-19' },
    ])
    // A Thursday has no later this week; a Saturday's weekend is the next one.
    expect(quickDays('2026-10-15').map((one) => one.kind)).toEqual([
      'today',
      'tomorrow',
      'weekend',
      'next-week',
    ])
    expect(quickDays('2026-10-17').slice(2)).toEqual([
      { kind: 'next-weekend', day: '2026-10-24' },
      { kind: 'next-week', day: '2026-10-19' },
    ])
    expect(quickDays('2026-10-18')[2]).toEqual({ kind: 'next-weekend', day: '2026-10-24' })
  })

  test('counts the open tasks each day already holds', () => {
    const rows: Row[] = taskRowsOfText(
      'Notes',
      'A.md',
      '- [ ] a 📅 2026-10-13\n- [ ] b ⏳ 2026-10-13\n- [x] c 📅 2026-10-13\n- [ ] d\n',
    )
    expect([...loadByDay(rows)]).toEqual([['2026-10-13', 2]])
  })

  test('reads a typed phrase with quick add’s grammar, in English and German', () => {
    expect(typedWhen('tomorrow 4pm', ['en'], NOW)).toEqual({ due: '2026-10-13', time: '16:00' })
    expect(typedWhen('morgen um 9', ['de'], NOW)).toEqual({ due: '2026-10-13', time: '09:00' })
    expect(typedWhen('every monday', ['en'], NOW)).toMatchObject({
      due: '2026-10-12',
      recurrence: 'every week on Monday',
    })
    expect(typedWhen('in 3 days', ['en'], NOW)).toEqual({ due: '2026-10-15' })
    expect(typedWhen('tomorrow and more words', ['en'], NOW)).toBeNull()
    expect(typedWhen('', ['en'], NOW)).toBeNull()
  })

  test('repeats for the day picked, written in the Tasks plugin’s words', () => {
    expect(REPEATS.map((kind) => repeatRule(kind, '2026-10-12'))).toEqual([
      'every day',
      'every week on Monday',
      'every weekday',
      'every month on the 12th',
      'every October on the 12th',
    ])
    expect(repeatKindOf('every week on monday', '2026-10-12')).toBe('weekly')
    expect(repeatKindOf('every 3 days', '2026-10-12')).toBeNull()
  })

  test('a pick changes the date the task is kept by, and No date takes its time too', () => {
    expect(changeFor({ due: '2026-10-01' }, { due: '2026-10-13' })).toEqual({ due: '2026-10-13' })
    expect(changeFor({ scheduled: '2026-10-01' }, { due: '2026-10-13', time: '09:00' })).toEqual({
      scheduled: '2026-10-13',
      time: '09:00',
    })
    expect(changeFor({ due: '2026-10-01', scheduled: '2026-09-30' }, { due: null })).toEqual({
      due: null,
      scheduled: null,
      time: null,
      recurrence: null,
    })
    expect(changeFor(null, { due: '2026-10-13', recurrence: 'every day' })).toEqual({
      due: '2026-10-13',
      recurrence: 'every day',
    })
  })
})
