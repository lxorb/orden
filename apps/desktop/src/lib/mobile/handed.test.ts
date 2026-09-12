import { describe, expect, test } from 'vitest'
import { askedFrom } from './handed'

/** What a quick settings tile or a widget row asked for.
 *
 *  Two strings, and neither is trusted: a command id the page looks up in its own
 *  registry and does nothing about if it is not there, and a path it tries to
 *  open, which the crate judges as it judges every other path. What matters here
 *  is that nothing else ever comes out of it. */

describe('what the press asked for', () => {
  test('a command', () => {
    expect(askedFrom('{"command":"new","open":""}')).toEqual({ command: 'new', open: '' })
  })

  test('a note', () => {
    expect(askedFrom('{"command":"","open":"/Notes/Plan.md"}')).toEqual({
      command: '',
      open: '/Notes/Plan.md',
    })
  })

  test('nothing, in every shape nothing arrives in', () => {
    const nothing = { command: '', open: '' }

    expect(askedFrom('')).toEqual(nothing)
    expect(askedFrom('undefined')).toEqual(nothing)
    expect(askedFrom('null')).toEqual(nothing)
    expect(askedFrom('[]')).toEqual(nothing)
    expect(askedFrom('{}')).toEqual(nothing)
    // Neither field is a string, so neither field is read.
    expect(askedFrom('{"command":{"run":1},"open":7}')).toEqual(nothing)
  })
})
