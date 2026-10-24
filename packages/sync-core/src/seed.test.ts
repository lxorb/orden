import { emptyCanvas, readCanvas, writeCanvas, type Canvas } from '@nib/markdown/canvas'
import { readPlane } from '@nib/rooms/plane'
import { TEXT } from '@nib/rooms'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { note } from '../test/markdown'
import { hash32, seedPlane, seedUpdate } from './seed'

function textOf(...updates: Uint8Array[]): string {
  const doc = new Y.Doc()
  for (const update of updates) Y.applyUpdateV2(doc, update)
  return doc.getText(TEXT).toJSON()
}

describe('hash32', () => {
  test('is FNV-1a: fixed, unsigned, the same everywhere', () => {
    expect(hash32('note', 1)).toBe(hash32('note', 1))
    expect(hash32('note', 1)).toBeGreaterThanOrEqual(0)
    expect(hash32('note', 1)).toBeLessThan(2 ** 32)
    // Pinned, so a change to the spelling is a change somebody has to mean: every
    // seed on every device and in every room hangs on it.
    expect(hash32()).toBe(0x811c9dc5)
    expect(hash32('n1', 1)).toBe(hash32('n1', 1))
  })

  test('tells a number from its text, and the parts from their concatenation', () => {
    expect(hash32('a', 1)).not.toBe(hash32('a', '1'))
    expect(hash32('ab', 'c')).not.toBe(hash32('a', 'bc'))
    expect(hash32('note', 'account')).not.toBe(hash32('note', 1))
  })
})

describe('seedUpdate', () => {
  test('two seeds of one text are byte-identical and merge to one copy', () => {
    const one = seedUpdate('n1', 1, 'Hello\nworld')
    const other = seedUpdate('n1', 1, 'Hello\nworld')

    expect(one).toEqual(other)
    expect(textOf(one, other)).toBe('Hello\nworld')
    expect(textOf(Y.mergeUpdatesV2([one, other]))).toBe('Hello\nworld')
  })

  test('another epoch is another document', () => {
    expect(seedUpdate('n1', 1, 'x')).not.toEqual(seedUpdate('n1', 2, 'x'))
  })

  test('seeds with line feeds whatever the file used', () => {
    expect(seedUpdate('n1', 1, 'a\r\nb\rc')).toEqual(seedUpdate('n1', 1, 'a\nb\nc'))
    expect(textOf(seedUpdate('n1', 1, 'a\r\nb'))).toBe('a\nb')
  })

  test('an empty text seeds an empty document', () => {
    expect(textOf(seedUpdate('n1', 1, ''))).toBe('')
  })
})

describe('seedPlane', () => {
  const canvas: Canvas = {
    ...emptyCanvas(),
    nodes: [
      { id: 'a', type: 'text', text: 'One', x: 0, y: 0, width: 100, height: 60 },
      { id: 'b', type: 'text', text: 'Two', x: 200, y: 0, width: 100, height: 60 },
    ],
    at: { a: 5, b: 6 },
    gone: { z: 3, y: 4 },
  }

  test('reads back as the canvas it was seeded from', () => {
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, seedPlane('c1', 1, canvas))
    const read = readPlane(doc)

    expect(read.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(read.gone).toEqual({ y: 4, z: 3 })
  })

  test('the same canvas, its fields in another order, seeds the same bytes', () => {
    const shuffled: Canvas = {
      ...canvas,
      nodes: [
        { height: 60, width: 100, y: 0, x: 0, text: 'One', type: 'text', id: 'a' },
        { id: 'b', type: 'text', x: 200, y: 0, text: 'Two', width: 100, height: 60 },
      ],
      gone: { y: 4, z: 3 },
    }

    expect(seedPlane('c1', 1, shuffled)).toEqual(seedPlane('c1', 1, canvas))
  })
})

describe('seed property', () => {
  test('property: two seeds of one note are byte-identical and merge to one copy', () => {
    fc.assert(
      fc.property(note, fc.string({ minLength: 1, maxLength: 12 }), (text, id) => {
        const one = seedUpdate(id, 1, text)
        const other = seedUpdate(id, 1, text)
        expect(one).toEqual(other)
        expect(textOf(one, other)).toBe(text.replace(/\r\n?/g, '\n'))
        expect(textOf(Y.mergeUpdatesV2([one, other, one]))).toBe(text.replace(/\r\n?/g, '\n'))
      }),
      { numRuns: 1000 },
    )
  })
})

/** A canvas holding what the format does not read (#780): its seed is the seed a build
 *  before this one makes, and one operation more under a client id of its own, so the
 *  two builds' seeds are one document and two of this build's are the same bytes. */
describe('the seed of a canvas with another app’s things in it', () => {
  const VAULT = readCanvas(
    JSON.stringify({
      nodes: [
        { id: 'x', type: 'excalidraw', x: 0, y: 0, width: 200, height: 100 },
        { id: 'a', type: 'text', text: 'a', x: 300, y: 0, width: 200, height: 60 },
      ],
      edges: [{ id: 'e', fromNode: 'x', toNode: 'a' }],
    }),
  )
  // The same canvas as a build before #780 reads it: nothing unread held.
  const bare: Canvas = { ...VAULT }
  delete bare.extras

  test('is the same bytes on every device', () => {
    expect(seedPlane('n1', 1, VAULT)).toEqual(seedPlane('n1', 1, readCanvas(writeCanvas(VAULT))))
  })

  test('holds the older seed whole, and adds only the extras', () => {
    const older = seedPlane('n1', 1, bare)
    const newer = seedPlane('n1', 1, VAULT)
    // The older seed tells the newer document nothing it does not already have.
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, newer)
    const before = Y.encodeStateVector(doc)
    Y.applyUpdateV2(doc, older)
    expect(Y.encodeStateVector(doc)).toEqual(before)
    expect(readPlane(doc).extras?.nodes.has('x')).toBe(true)
    expect(readPlane(doc).nodes.map((one) => one.id)).toEqual(['a'])
  })
})
