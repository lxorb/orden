import { describe, expect, test } from 'vitest'
import { roomKind, roomKindOf } from './kind'

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
