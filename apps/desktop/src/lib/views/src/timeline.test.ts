import { describe, expect, test } from 'vitest'
import { noteValues, type Row, type Value } from '@orden/bases'
import { type Bar, barOf, dragged } from './timeline'

function inZone(zone: string, run: () => void): void {
  const was = process.env.TZ
  process.env.TZ = zone
  try {
    run()
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
}

const row = { kind: 'note' } as unknown as Row

function barFor(written: string) {
  const value: Value = noteValues(`due: ${written}`).due ?? null
  const bar = barOf(row, { start: 'due' }, () => value)
  if (!bar) throw new Error('no bar')
  return bar
}

describe('a bar for a date written with its offset', () => {
  test('moved a day keeps the offset it was written with', () => {
    inZone('America/Los_Angeles', () => {
      expect(dragged(barFor('2026-03-10T23:00:00+09:00'), 'move', 1)).toEqual({
        due: '2026-03-11T23:00+09:00',
      })
      expect(dragged(barFor('2026-11-15T17:00:00Z'), 'move', 2)).toEqual({
        due: '2026-11-17T17:00Z',
      })
    })
  })

  test('sits on the day it falls on here, and moves the day it was written on', () => {
    inZone('America/Los_Angeles', () => {
      const bar = barFor('2026-03-10T02:00:00+09:00')
      expect(bar.start).toBe('2026-03-09')
      expect(dragged(bar, 'move', 1)).toEqual({ due: '2026-03-11T02:00+09:00' })
    })
  })

  test('without an offset or seconds keeps its hour and minutes as written', () => {
    inZone('Asia/Tokyo', () => {
      expect(dragged(barFor('2026-03-10T23:00'), 'move', 1)).toEqual({ due: '2026-03-11T23:00' })
      expect(dragged(barFor('2026-03-10'), 'move', -1)).toEqual({ due: '2026-03-09' })
    })
  })
})

const taskRow = { kind: 'task', task: { text: 'Draft' } } as unknown as Row
const noteRow = { kind: 'note', note: {} } as unknown as Row

const single = (row: Row, field: string): Bar => ({
  row,
  start: '2026-03-05',
  end: '2026-03-05',
  from: field,
  to: field,
  ...(row.task ? { ownDates: true } : {}),
})

test.each(['task.start', 'task.scheduled'])(
  'the end edge of a %s-only task stretches it to a deadline and leaves its date',
  (field) => {
    expect(dragged(single(taskRow, field), 'end', 3)).toEqual({ 'task.deadline': '2026-03-08' })
  },
)

test.each(['task.start', 'task.scheduled'])(
  'the start edge of a %s-only task moves its date and keeps the old one as the deadline',
  (field) => {
    expect(dragged(single(taskRow, field), 'start', -2)).toEqual({
      [field]: '2026-03-03',
      'task.deadline': '2026-03-05',
    })
  },
)

test('the end edge of a deadline-only task keeps the start where it was', () => {
  expect(dragged(single(taskRow, 'task.deadline'), 'end', 3)).toEqual({
    'task.start': '2026-03-05',
    'task.deadline': '2026-03-08',
  })
})

test('the start edge of a deadline-only task writes a start before it', () => {
  expect(dragged(single(taskRow, 'task.deadline'), 'start', -2)).toEqual({
    'task.start': '2026-03-03',
  })
})

test('an edge pushed past the other end of a one-day task changes nothing', () => {
  expect(dragged(single(taskRow, 'task.start'), 'start', 2)).toEqual({})
  expect(dragged(single(taskRow, 'task.start'), 'end', -2)).toEqual({})
})

test('an edge of a note bar with no end property moves no date', () => {
  expect(dragged(single(noteRow, 'note.date'), 'end', 3)).toEqual({})
  expect(dragged(single(noteRow, 'note.date'), 'start', -2)).toEqual({})
})

test('a bar with two ends still stretches the end it is dragged by', () => {
  const bar: Bar = {
    row: noteRow,
    start: '2026-03-05',
    end: '2026-03-07',
    from: 'note.start',
    to: 'note.end',
    fromTime: '',
    toTime: '',
  }
  expect(dragged(bar, 'end', 1)).toEqual({ 'note.end': '2026-03-08' })
  expect(dragged(bar, 'start', -1)).toEqual({ 'note.start': '2026-03-04' })
  expect(dragged(bar, 'move', 1)).toEqual({ 'note.start': '2026-03-06', 'note.end': '2026-03-08' })
})

test('an edge of a task bar drawn from a date property the view names, with no end, writes nothing', () => {
  const bar = barOf(taskRow, { start: 'task.scheduled' }, () => ({
    kind: 'date',
    iso: '2026-03-05',
  }))
  if (!bar) throw new Error('no bar')
  expect(dragged(bar, 'end', 3)).toEqual({})
  expect(dragged(bar, 'start', -2)).toEqual({})
  expect(dragged(bar, 'move', 1)).toEqual({ 'task.scheduled': '2026-03-06' })
})

test('a task with only a date in the default timeline gets its own dates', () => {
  const row = { kind: 'task', task: { text: 'Draft', scheduled: '2026-03-05' } } as unknown as Row
  expect(barOf(row, {}, () => null)).toMatchObject({ from: 'task.scheduled', ownDates: true })
})
