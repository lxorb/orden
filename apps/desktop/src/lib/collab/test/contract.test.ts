import { describe, expect, test } from 'vitest'
import { inRooms, roomKind, roomKindOf, rooms } from '../src/api'

describe('which room a note needs', () => {
  test('a note is words, a canvas or a page note a plane, a web address none', () => {
    expect(roomKind('/Notes/plan.md')).toBe('words')
    expect(roomKind('/Boards/board.canvas')).toBe('plane')
    expect(roomKind('/Decks/talk.pages')).toBe('plane')
    expect(roomKind('/Links/orden.url')).toBeNull()
    expect(roomKind(null)).toBe('words')
  })

  test('a shared draft with no file is asked by its kind', () => {
    expect(roomKindOf({ path: null, shared: 'note-1', kind: 'canvas' })).toBe('plane')
    expect(roomKindOf({ path: null, shared: 'note-1', kind: 'note' })).toBe('words')
    expect(roomKindOf({ path: '/Notes/plan.md', shared: null, kind: 'canvas' })).toBe('words')
  })
})

describe('the notes that are in rooms', () => {
  const note = (shared: string | null) =>
    ({ shared }) as unknown as Parameters<typeof inRooms>[0][number]['note']

  test('are the shared ones and the tracked ones, each with its id, version and hash', () => {
    const tracked = (path: string) =>
      path === '/a.md' ? { id: 'id-a', version: 3, hash: 'h' } : null
    const open = [
      { key: 'k1', path: '/a.md', note: note(null) },
      { key: 'k2', path: '/b.md', note: note(null) },
      { key: 'k3', path: '/c.md', note: note('shared-c') },
    ]
    expect(
      inRooms(open, tracked).map(({ key, noteId, version, hash }) => ({
        key,
        noteId,
        version,
        hash,
      })),
    ).toEqual([
      { key: 'k1', noteId: 'id-a', version: 3, hash: 'h' },
      { key: 'k3', noteId: 'shared-c', version: 0, hash: null },
    ])
    expect(inRooms(open, null).map((one) => one.key)).toEqual(['k3'])
  })
})

describe('the room store', () => {
  test('remembers who is present per key and forgets a key nobody is in', () => {
    rooms.heard('k', 2, { people: [], mine: 1 })
    expect(rooms.present.k).toBe(2)
    expect(rooms.seen.k).toEqual({ people: [], mine: 1 })
    rooms.heard('k', 0)
    expect(rooms.present).not.toHaveProperty('k')
    expect(rooms.seen).not.toHaveProperty('k')
  })

  test('carries no note until a room has settled', () => {
    expect(rooms.carries('note-1')).toBe(false)
  })
})
