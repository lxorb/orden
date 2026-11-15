import type { Row } from '@orden/bases'
import { expect, test } from 'vitest'
import { type Bar, dragged } from './timeline'

const taskRow = { kind: 'task', task: { text: 'Draft' } } as unknown as Row
const noteRow = { kind: 'note', note: {} } as unknown as Row

const single = (row: Row, field: string): Bar => ({
  row,
  start: '2026-03-05',
  end: '2026-03-05',
  from: field,
  to: field,
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
