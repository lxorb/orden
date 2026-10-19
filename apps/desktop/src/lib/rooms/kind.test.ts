import { describe, expect, test } from 'vitest'
import { roomKind, roomKindOf } from './kind'

/** The shape of room a file wants is its name, on both ends of the wire. A file shared
 *  on its own has no name here - no path - and asking the missing one took every shared
 *  canvas for words: the guest's plane was in a room of text, and nothing drawn on either
 *  side reached the other (#386). */
describe('roomKindOf', () => {
  test('a file on this machine is asked by its name, whatever the tab was opened as', () => {
    expect(roomKindOf({ path: '/Boards/board.canvas', shared: null, kind: 'canvas' })).toBe('plane')
    expect(roomKindOf({ path: '/Boards/board.canvas', shared: null, kind: 'note' })).toBe(
      roomKind('/Boards/board.canvas'),
    )
    expect(roomKindOf({ path: '/Notes/plan.md', shared: null, kind: 'canvas' })).toBe('words')
  })

  test('a canvas somebody shared on its own is a plane', () => {
    expect(roomKindOf({ path: null, shared: 'note-1', kind: 'canvas' })).toBe('plane')
  })

  test('so is a page note, and a shared note is words', () => {
    expect(roomKindOf({ path: null, shared: 'note-1', kind: 'pages' })).toBe('plane')
    expect(roomKindOf({ path: null, shared: 'note-1', kind: 'note' })).toBe('words')
  })

  test('a draft nobody shared is words, as a file with no name always was', () => {
    expect(roomKindOf({ path: null, shared: null, kind: 'canvas' })).toBe('words')
  })
})
