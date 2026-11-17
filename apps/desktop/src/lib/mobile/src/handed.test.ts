import { describe, expect, test } from 'vitest'
import { askedFrom, HANDED, openable } from './handed'

const nothing = { command: '', open: '', tick: '', tickSpace: '' }

describe('what the press asked for', () => {
  test('a command', () => {
    expect(askedFrom('{"command":"new","open":""}')).toEqual({ ...nothing, command: 'new' })
  })

  test('a note', () => {
    expect(askedFrom('{"command":"","open":"/Notes/Plan.md"}')).toEqual({
      ...nothing,
      open: '/Notes/Plan.md',
    })
  })

  test('a task a Today box asked to tick', () => {
    expect(askedFrom('{"tick":"Inbox.md#0:abc","tickSpace":"Home"}')).toEqual({
      ...nothing,
      tick: 'Inbox.md#0:abc',
      tickSpace: 'Home',
    })
  })

  test('only a command a tile or a widget sends', () => {
    for (const id of HANDED) expect(askedFrom(`{"command":"${id}"}`).command).toBe(id)
    for (const id of ['dictate', 'signout', 'record-audio', 'quit'])
      expect(askedFrom(`{"command":"${id}"}`).command).toBe('')
  })

  test('nothing, in every shape nothing arrives in', () => {
    expect(askedFrom('')).toEqual(nothing)
    expect(askedFrom('undefined')).toEqual(nothing)
    expect(askedFrom('null')).toEqual(nothing)
    expect(askedFrom('[]')).toEqual(nothing)
    expect(askedFrom('{}')).toEqual(nothing)
    expect(askedFrom('{"command":{"run":1},"open":7}')).toEqual(nothing)
  })
})

describe('the note a widget row named', () => {
  test('is nothing at all while this app holds no spaces', () => {
    expect(openable('/data/data/so.orden.app/databases/notes.db')).toBeNull()
    expect(openable('/sdcard/Download/whatever.md')).toBeNull()
  })
})
