import { describe, expect, test } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { awarenessUpdate, receive, TEXT } from '@nib/rooms'
import * as Y from 'yjs'
import { peersIn, relative } from './peers'

/** Two devices, each with its own copy of the same words and its own awareness.
 *  What is measured is whether one can say where its caret is and the other can
 *  put it in the right place - including after the words underneath have moved. */
function pair(words: string) {
  const one = new Y.Doc()
  const two = new Y.Doc()
  one.getText(TEXT).insert(0, words)
  Y.applyUpdate(two, Y.encodeStateAsUpdate(one))

  return {
    one: { doc: one, text: one.getText(TEXT), awareness: new Awareness(one) },
    two: { doc: two, text: two.getText(TEXT), awareness: new Awareness(two) },
  }
}

describe('who else is in a note', () => {
  test('is nobody when nobody has said anything', () => {
    const { two } = pair('words\n')
    expect(peersIn(two.awareness, two.doc, 'dark')).toEqual({ present: 0, carets: [] })
  })

  test('never counts the device asking', () => {
    const { one } = pair('words\n')
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })

    expect(peersIn(one.awareness, one.doc, 'dark').present).toBe(0)
  })

  test('is somebody in the note before they have put a caret anywhere', () => {
    const { one, two } = pair('words\n')
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    const found = peersIn(two.awareness, two.doc, 'dark')
    expect(found.present).toBe(1)
    expect(found.carets).toEqual([])
  })

  test('carries a name, a caret and the shade the scheme needs', () => {
    const { one, two } = pair('one\ntwo\n')
    one.awareness.setLocalStateField('who', { name: 'Android', accent: 'teal' })
    one.awareness.setLocalStateField('caret', {
      anchor: relative(one.text, 4),
      head: relative(one.text, 7),
    })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    const { present, carets } = peersIn(two.awareness, two.doc, 'dark')
    expect(present).toBe(1)
    expect(carets).toHaveLength(1)
    expect(carets[0]).toMatchObject({ id: one.doc.clientID, name: 'Android', anchor: 4, head: 7 })

    // Teal, in the shade a dark background needs; the light one is another value.
    expect(carets[0]?.colour).toBe('#33c7ba')
    expect(peersIn(two.awareness, two.doc, 'light').carets[0]?.colour).toBe('#0f9b8e')
  })

  test('moves the caret along when words are written above it', () => {
    const { one, two } = pair('one\ntwo\n')
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })
    one.awareness.setLocalStateField('caret', {
      anchor: relative(one.text, 4),
      head: relative(one.text, 4),
    })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.head).toBe(4)

    // The other device writes a line above the caret, and says nothing new about
    // where its caret is. A number would have gone stale; a relative position has
    // not, because it names a character rather than an offset.
    two.text.insert(0, 'nought\n')
    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.head).toBe(11)
  })

  test('leaves out a caret that says nothing readable', () => {
    const { two } = pair('words\n')
    // A state from a build that said something else, or from nothing at all.
    two.awareness.setLocalState({ who: 'Mac' })
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({ nonsense: true })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').present).toBe(0)
  })
})
