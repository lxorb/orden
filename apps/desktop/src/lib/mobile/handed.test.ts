import { describe, expect, test } from 'vitest'
import { askedFrom, openable } from './handed'

/** What a quick settings tile or a widget row asked for.
 *
 *  Two strings, and neither is trusted: a command id the page looks up in its own
 *  registry and does nothing about if it is not there, and a path it only opens
 *  once it has been found inside one of this app's own spaces. The activity that
 *  carries both is exported, so anything on the phone can send one; what matters
 *  here is that nothing else ever comes out of it. */

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

describe('the note a widget row named', () => {
  test('is nothing at all while this app holds no spaces', () => {
    // Which is the shape the hole had: an exported activity could name any file
    // the app itself may read, and the page handed it straight to the crate. The
    // judgement itself is insideAnyOf, in space-paths.test.ts.
    expect(openable('/data/data/com.nibeditor.app/databases/notes.db')).toBeNull()
    expect(openable('/sdcard/Download/whatever.md')).toBeNull()
  })
})
