import { describe, expect, test } from 'vitest'
import { countsOf, slotsOf } from './sun-slots'

const line = (name: string, ...kinds: string[]) => kinds.map((kind) => ({ line: name, kind }))
const shown = (slots: ReturnType<typeof slotsOf<{ line: string; kind: string }>>) =>
  slots.map((slot) => [slot.line, slot.kinds.map((one) => one.kind)])

describe('the groups on the sun', () => {
  test('each keep a quarter of their own: notes up, chats right, terminals down, the browser left', () => {
    const slots = slotsOf([
      line('notes', 'note', 'canvas'),
      line('chats', 'ai'),
      line('terminals', 'terminal'),
      line('browser', 'web'),
    ])
    expect(shown(slots)).toEqual([
      ['notes', ['note', 'canvas']],
      ['chats', ['ai']],
      ['terminals', ['terminal']],
      ['browser', ['web']],
    ])
    expect(countsOf(slots)).toEqual([2, 1, 1, 1])
  })
  test('leave a missing or empty group out entirely, so the groups left share the whole circle (#2557)', () => {
    expect(shown(slotsOf([line('notes', 'note'), line('browser', 'web')]))).toEqual([
      ['notes', ['note']],
      ['browser', ['web']],
    ])
    expect(shown(slotsOf([line('notes', 'note'), [], line('terminals', 'terminal'), line('browser', 'web')]))).toEqual([
      ['notes', ['note']],
      ['terminals', ['terminal']],
      ['browser', ['web']],
    ])
    expect(slotsOf([[], []])).toEqual([])
  })
  test('give the apps a place after the groups with a home', () => {
    expect(shown(slotsOf([line('notes', 'note'), line('chats', 'ai'), line('apps', 'pass')]))).toEqual([
      ['notes', ['note']],
      ['chats', ['ai']],
      ['apps', ['pass']],
    ])
  })
  test('and with none free, join the apps to the last quarter', () => {
    const slots = slotsOf([
      line('notes', 'note'),
      line('chats', 'ai'),
      line('terminals', 'terminal'),
      line('browser', 'web'),
      line('apps', 'pass'),
    ])
    expect(shown(slots)[3]).toEqual(['browser', ['web', 'pass']])
  })
})
