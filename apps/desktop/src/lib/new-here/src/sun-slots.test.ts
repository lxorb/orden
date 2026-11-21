import { describe, expect, test } from 'vitest'
import { countsOf, slotsOf } from './sun-slots'

const line = (name: string, ...kinds: string[]) => kinds.map((kind) => ({ line: name, kind }))
const shown = (slots: ReturnType<typeof slotsOf<{ line: string; kind: string }>>) =>
  slots.map((slot) => (slot ? [slot.line, slot.kinds.map((one) => one.kind)] : null))

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
  test('leave a quarter empty when its group is missing', () => {
    expect(shown(slotsOf([line('notes', 'note'), line('browser', 'web')]))).toEqual([
      ['notes', ['note']],
      null,
      null,
      ['browser', ['web']],
    ])
  })
  test('give the apps the first free quarter', () => {
    expect(shown(slotsOf([line('notes', 'note'), line('chats', 'ai'), line('apps', 'pass')]))).toEqual([
      ['notes', ['note']],
      ['chats', ['ai']],
      ['apps', ['pass']],
      null,
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
