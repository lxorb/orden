import { describe, expect, test } from 'vitest'
import { parseQuickAdd, parseTodo } from './index'

const NOW = new Date(2026, 9, 7, 10, 0)
const todo = (text: string, options = {}) => parseTodo(text, ['en'], NOW, options)

describe('a todo typed in one line', () => {
  test.each([
    ['Pay rent today', '2026-10-07'],
    ['Pay rent tomorrow', '2026-10-08'],
    ['Pay rent next monday', '2026-10-12'],
    ['Pay rent 30 nov', '2026-11-30'],
    ['Pay rent in 3 days', '2026-10-10'],
    ['Pay rent fri', '2026-10-09'],
  ])('%s starts on a day', (text, start) => {
    expect(todo(text)).toEqual({
      title: 'Pay rent',
      labels: [],
      start,
      chips: [{ kind: 'when', from: 9, to: text.length }],
    })
  })
  test.each([
    ['Pay rent {march 30}', '2027-03-30'],
    ['Pay rent by friday', '2026-10-09'],
  ])('%s is due by a day', (text, deadline) => {
    expect(todo(text)).toEqual({
      title: 'Pay rent',
      labels: [],
      deadline,
      chips: [{ kind: 'deadline', from: 9, to: text.length }],
    })
  })
  test.each([
    ['p1', 3],
    ['p2', 2],
    ['p3', 1],
    ['p4', 0],
  ])('%s is priority %i on the Orden scale', (word, priority) => {
    expect(todo(`Pay rent ${word}`)).toMatchObject({ title: 'Pay rent', priority })
  })
  test('labels come from # @ and %', () => {
    expect(todo('Buy milk #a #b')).toMatchObject({ title: 'Buy milk', labels: ['a', 'b'] })
    expect(todo('Buy milk @x %y')).toMatchObject({ title: 'Buy milk', labels: ['x', 'y'] })
  })
  test('a time stays in the title, the day beside it still starts the todo', () => {
    expect(todo('call at 4pm tomorrow')).toEqual({
      title: 'call at 4pm',
      labels: [],
      start: '2026-10-08',
      chips: [{ kind: 'when', from: 12, to: 20 }],
    })
    expect(todo('Call mum tomorrow at 4pm')).toEqual({
      title: 'Call mum at 4pm',
      labels: [],
      start: '2026-10-08',
      chips: [{ kind: 'when', from: 9, to: 17 }],
    })
  })
  test.each([
    'Water plants every monday',
    'Water plants !tomorrow',
    'Water plants for 30 min',
    'Water plants +bob',
    'Water plants at 9am',
    'Water plants tonight',
  ])('%s is all title, since a todo keeps no such field', (text) => {
    expect(todo(text)).toEqual({ title: text, labels: [], chips: [] })
  })
  test('kept and escaped spans stay words', () => {
    expect(todo('Read tomorrow', { keep: [{ from: 5, to: 13 }] })).toEqual({
      title: 'Read tomorrow',
      labels: [],
      chips: [],
    })
    expect(todo('Read #a', { escaped: [{ from: 5, to: 7 }] })).toEqual({ title: 'Read #a', labels: [], chips: [] })
  })
  test('the title closes the gaps the fields leave', () => {
    expect(todo('  Call   mum  p1   now  ').title).toBe('Call mum now')
    expect(todo('tomorrow Call mum #home')).toMatchObject({ title: 'Call mum', start: '2026-10-08', labels: ['home'] })
  })
  test('the full quick add still reads times, repeats and the rest', () => {
    expect(parseQuickAdd('Call mum tomorrow at 4pm every monday +bob', ['en'], NOW).fields).toMatchObject({
      time: '16:00',
      recurrence: expect.any(String),
      assignee: 'bob',
    })
  })
})
