import { describe, expect, test } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { awarenessUpdate, receive, TEXT } from '@orden/rooms'
import * as Y from 'yjs'
import { peersIn, relative } from './peers'
import { accentFor } from '../../accents'

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
    expect(peersIn(two.awareness, two.doc, 'dark')).toEqual({
      present: 0,
      carets: [],
      seen: { people: [], mine: 0 },
    })
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

    expect(carets[0]?.colour).toBe('#33c7ba')
    expect(peersIn(two.awareness, two.doc, 'light').carets[0]?.colour).toBe('#0d7d73')
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

    two.text.insert(0, 'nought\n')
    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.head).toBe(11)
  })

  test('leaves out a caret that says nothing readable', () => {
    const { two } = pair('words\n')
    two.awareness.setLocalState({ who: 'Mac' })
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({ nonsense: true })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').present).toBe(0)
  })
})

describe('what a caret is labelled with', () => {
  function announce(
    end: { doc: Y.Doc; text: Y.Text; awareness: Awareness },
    who: { name: string; accent: string; person?: string },
  ) {
    end.awareness.setLocalStateField('who', who)
    end.awareness.setLocalStateField('caret', {
      anchor: relative(end.text, 0),
      head: relative(end.text, 0),
    })
  }

  test('is the device, when the room holds one person’s machines', () => {
    const { one, two } = pair('words\n')
    announce(one, { name: 'Android', accent: 'teal', person: 'Emil' })
    announce(two, { name: 'Windows', accent: 'blue', person: 'Emil' })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.name).toBe('Android')
  })

  test('is the person, once more than one of them is in the note', () => {
    const { one, two } = pair('words\n')
    announce(one, { name: 'Android', accent: 'teal', person: 'Ada' })
    announce(two, { name: 'Windows', accent: 'blue', person: 'Emil' })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.name).toBe('Ada')
  })

  test('is the person for everybody, including the reader’s own other machine', () => {
    const { one, two } = pair('words\n')
    const third = new Y.Doc()
    Y.applyUpdate(third, Y.encodeStateAsUpdate(one.doc))
    const mine = { doc: third, text: third.getText(TEXT), awareness: new Awareness(third) }

    announce(one, { name: 'Android', accent: 'teal', person: 'Ada' })
    announce(mine, { name: 'Mac', accent: 'rose', person: 'Emil' })
    announce(two, { name: 'Windows', accent: 'blue', person: 'Emil' })

    for (const end of [one, mine]) {
      receive(awarenessUpdate(end.awareness, [end.doc.clientID]), two.doc, two.awareness, 'room')
    }

    const names = peersIn(two.awareness, two.doc, 'dark')
      .carets.map((caret) => caret.name)
      .sort()
    expect(names).toEqual(['Ada', 'Emil'])
  })

  test('is the device when nobody says who they are, which is a signed-out room', () => {
    const { one, two } = pair('words\n')
    announce(one, { name: 'Firefox', accent: 'teal' })
    announce(two, { name: 'Windows', accent: 'blue' })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.name).toBe('Firefox')
  })

  test('falls back to the device for whoever did not send a person', () => {
    const { one, two } = pair('words\n')
    announce(one, { name: 'Android', accent: 'teal' })
    announce(two, { name: 'Windows', accent: 'blue', person: 'Emil' })

    const third = new Y.Doc()
    Y.applyUpdate(third, Y.encodeStateAsUpdate(one.doc))
    const other = { doc: third, text: third.getText(TEXT), awareness: new Awareness(third) }
    announce(other, { name: 'Mac', accent: 'rose', person: 'Ada' })

    for (const end of [one, other]) {
      receive(awarenessUpdate(end.awareness, [end.doc.clientID]), two.doc, two.awareness, 'room')
    }

    const names = peersIn(two.awareness, two.doc, 'dark')
      .carets.map((caret) => caret.name)
      .sort()
    expect(names).toEqual(['Ada', 'Android'])
  })
})

describe('a caret nothing in this app would have sent', () => {
  function saying(caret: unknown) {
    const { two } = pair('one\ntwo\n')
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({ who: { name: 'Mac', accent: 'blue' }, caret })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    return two
  }

  test('carries a name that is a label rather than a paragraph', () => {
    const { two } = pair('one\ntwo\n')
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({
      who: { name: 'x'.repeat(5000), accent: 'blue' },
      caret: { anchor: relative(two.text, 0), head: relative(two.text, 0) },
    })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    const name = peersIn(two.awareness, two.doc, 'dark').carets[0]?.name ?? ''
    expect(name.length).toBeLessThan(100)
  })

  test('leaves the note with a peer and no caret rather than throwing', () => {
    const two = saying({ anchor: null, head: { item: 5 } })
    const found = peersIn(two.awareness, two.doc, 'dark')

    expect(found.present).toBe(1)
    expect(found.carets).toEqual([])
  })

  test('leaves it out when the position names a place that cannot exist', () => {
    const two = saying({
      anchor: { item: { client: 1, clock: 0 } },
      head: { item: { client: 1, clock: -1 } },
    })
    const found = peersIn(two.awareness, two.doc, 'dark')

    expect(found.present).toBe(1)
    expect(found.carets).toEqual([])
  })
})

describe('an unreadable presence', () => {
  test('is left out', () => {
    const { two } = pair('words\n')
    two.awareness.setLocalState({ who: 'Mac' })
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({ nonsense: true })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').present).toBe(0)
  })
})

describe('the faces of who else is in a note', () => {
  const FACE = 'f'.repeat(64)

  function heard(who: Record<string, unknown>, mine: Record<string, unknown>) {
    const { one, two } = pair('words\n')
    one.awareness.setLocalStateField('who', who)
    one.awareness.setLocalStateField('caret', {
      anchor: relative(one.text, 0),
      head: relative(one.text, 0),
    })
    two.awareness.setLocalStateField('who', mine)
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')
    return peersIn(two.awareness, two.doc, 'dark')
  }

  test('are another person’s, by their account, with their picture and their account’s colour, whatever tint an older build sends', () => {
    const found = heard(
      { name: 'Mac', accent: 'blue', person: 'Lucile', id: 'u-lucile', face: FACE, tint: 'teal' },
      { name: 'Windows', accent: 'red', person: 'Emil', id: 'u-emil' },
    )

    expect(found.seen).toEqual({
      people: [
        {
          key: 'u-lucile',
          name: 'Lucile',
          face: `https://orden.so/i/${FACE}.webp`,
          fill: accentFor('u-lucile', 'dark'),
        },
      ],
      mine: 0,
    })
    expect(found.carets[0]).toMatchObject({
      name: 'Lucile',
      face: `https://orden.so/i/${FACE}.webp`,
    })
  })

  test('leave this account’s own other devices as dots, named by the device', () => {
    const found = heard(
      { name: 'Phone', accent: 'blue', person: 'Emil', id: 'u-emil', face: FACE },
      { name: 'Windows', accent: 'red', person: 'Emil', id: 'u-emil' },
    )

    expect(found.seen).toEqual({ people: [], mine: 1 })
    expect(found.carets[0]).toMatchObject({ name: 'Phone', face: undefined })
  })

  test('take nothing for a face that is not a hash', () => {
    const found = heard(
      { name: 'Mac', accent: 'blue', person: 'Mia', id: 'u-mia', face: 'javascript:alert(1)' },
      { name: 'Windows', accent: 'red', person: 'Emil', id: 'u-emil' },
    )

    expect(found.seen.people[0]?.face).toBeNull()
    expect(found.carets[0]?.face).toBeUndefined()
  })
})
