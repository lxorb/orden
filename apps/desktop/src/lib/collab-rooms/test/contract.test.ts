import { describe, expect, test } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { replace, replacements } from '../src/bind'
import { HAND, saidHand } from '../src/hands'
import { peersIn, relative } from '../src/peers'

const NOTE = 'note'

function pair(words: string) {
  const one = new Y.Doc()
  const two = new Y.Doc()
  one.getText(NOTE).insert(0, words)
  Y.applyUpdate(two, Y.encodeStateAsUpdate(one))
  return {
    one: { doc: one, text: one.getText(NOTE), awareness: new Awareness(one) },
    two: { doc: two, text: two.getText(NOTE), awareness: new Awareness(two) },
  }
}

describe('edits between a shared text and a note', () => {
  test('a yjs delta becomes replacements, neighbours folded into one', () => {
    expect(replacements([{ retain: 2 }, { insert: 'ab' }, { delete: 1 }, { insert: 'c' }])).toEqual(
      [{ from: 2, to: 3, insert: 'abc' }],
    )
    expect(replacements([{ delete: 1 }, { retain: 3 }, { insert: 'x' }])).toEqual([
      { from: 0, to: 1, insert: '' },
      { from: 4, to: 4, insert: 'x' },
    ])
    expect(replacements([{ insert: { embed: true } }])).toEqual([])
  })

  test('a replacement applied to the text is what the delta said', () => {
    const { one } = pair('hello world')
    replace(one.text, { from: 6, to: 11, insert: 'there' })
    expect(one.text.toJSON()).toBe('hello there')
    replace(one.text, { from: 0, to: 0, insert: 'oh ' })
    expect(one.text.toJSON()).toBe('oh hello there')
  })
})

describe('who else is in a note', () => {
  test('nobody until somebody says who they are, and never the device asking', () => {
    const { one, two } = pair('words\n')
    expect(peersIn(two.awareness, two.doc, 'dark')).toEqual({
      present: 0,
      carets: [],
      seen: { people: [], mine: 0 },
    })
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })
    expect(peersIn(one.awareness, one.doc, 'dark').present).toBe(0)
  })

  test('a caret is kept as a relative position that survives edits before it', () => {
    const { one } = pair('abc')
    const at = relative(one.text, 2)
    one.text.insert(0, 'zz')
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(at),
      one.doc,
    )
    expect(absolute?.index).toBe(4)
  })
})

describe('a hand on a canvas', () => {
  test('is a rounded point, with the stroke it is drawing when it draws', () => {
    expect(HAND).toBe('hand')
    expect(saidHand({ x: 1.26, y: 2.04 }, null)).toEqual({ x: 1.3, y: 2 })
    const drawing = {
      id: 'ink',
      tool: 'pen',
      color: '#000',
      size: 2,
      points: [{ x: 0, y: 0, p: 0.5 }],
    } as unknown as Parameters<typeof saidHand>[1]
    const said = saidHand({ x: 0, y: 0 }, drawing)
    expect(said.ink).toMatchObject({ tool: 'pen', color: '#000', size: 2 })
  })
})
