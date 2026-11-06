import { describe, expect, test } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  awarenessState,
  awarenessUpdate,
  forget,
  isCatchUp,
  isEdit,
  readSync,
  receive,
  syncStep1,
  syncStep1Of,
  syncStep2Of,
  syncUpdate,
  TEXT,
  unattended,
} from './wire'

class End {
  readonly doc = new Y.Doc()
  readonly awareness: Awareness
  readonly text = this.doc.getText(TEXT)

  constructor() {
    this.awareness = new Awareness(this.doc)
  }

  get words(): string {
    return this.text.toJSON()
  }

  hear(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'wire')
  }
}

function exchange(from: End, to: End, first: Uint8Array) {
  let message: Uint8Array | null = first
  let side: [End, End] = [to, from]

  for (let round = 0; round < 8 && message; round++) {
    const [hearing, answering] = side
    message = hearing.hear(message)
    side = [answering, hearing]
  }
}

describe('the wire', () => {
  test('brings a fresh end up to what the other holds', () => {
    const one = new End()
    const two = new End()
    one.text.insert(0, '# Note\nwords\n')

    exchange(two, one, syncStep1(two.doc))

    expect(two.words).toBe('# Note\nwords\n')
  })

  test('leaves both ends with the same text when both wrote at once', () => {
    const one = new End()
    const two = new End()
    one.text.insert(0, 'start\n')
    exchange(two, one, syncStep1(two.doc))

    const before = { one: Y.encodeStateVector(one.doc), two: Y.encodeStateVector(two.doc) }
    one.text.insert(6, 'from one\n')
    two.text.insert(6, 'from two\n')

    two.hear(syncUpdate(Y.encodeStateAsUpdate(one.doc, before.one)))
    one.hear(syncUpdate(Y.encodeStateAsUpdate(two.doc, before.two)))

    expect(one.words).toBe(two.words)
    expect(one.words).toContain('from one')
    expect(one.words).toContain('from two')
  })

  test('carries who is there and where their caret is', () => {
    const one = new End()
    const two = new End()

    one.awareness.setLocalStateField('user', { name: 'One', colour: 'violet' })
    const message = awarenessState(one.awareness)
    expect(message).not.toBeNull()

    if (message) two.hear(message)

    expect(two.awareness.getStates().get(one.doc.clientID)).toEqual({
      user: { name: 'One', colour: 'violet' },
    })
  })

  test('has nothing to say about an unattended room', () => {
    const room = new End()
    unattended(room.awareness)

    expect(awarenessState(room.awareness)).toBeNull()
  })

  test('takes a caret away again', () => {
    const one = new End()
    const two = new End()

    one.awareness.setLocalStateField('user', { name: 'One' })
    two.hear(awarenessUpdate(one.awareness, [one.doc.clientID]))
    expect(two.awareness.getStates().has(one.doc.clientID)).toBe(true)

    forget(two.awareness, [one.doc.clientID], 'wire')
    expect(two.awareness.getStates().has(one.doc.clientID)).toBe(false)
  })

  test('hears a forgotten caret said again as it was, the way a reconnect says it', () => {
    const one = new End()
    const two = new End()

    one.awareness.setLocalStateField('user', { name: 'One' })
    two.hear(awarenessUpdate(one.awareness, [one.doc.clientID]))
    forget(two.awareness, [one.doc.clientID], 'wire')

    two.hear(awarenessUpdate(one.awareness, [one.doc.clientID]))
    expect(two.awareness.getStates().get(one.doc.clientID)).toEqual({ user: { name: 'One' } })
  })

  test('answers nothing to a message it does not know', () => {
    expect(new End().hear(new Uint8Array([9, 9, 9]))).toBeNull()
  })

  test('answers nothing to a message it cannot read at all', () => {
    const one = new End()

    expect(one.hear(new Uint8Array())).toBeNull()
    expect(one.hear(new Uint8Array([0]))).toBeNull()
    expect(one.hear(new Uint8Array([1]))).toBeNull()
    expect(one.hear(new Uint8Array([0, 2, 200, 200, 200]))).toBeNull()
    expect(one.hear(new Uint8Array([1, 3, 200, 200, 200]))).toBeNull()
  })
})

describe('which messages are the room catching a device up', () => {
  test('the answer to a state vector is', () => {
    const one = new End()
    one.text.insert(0, 'words\n')

    const answer = one.hear(syncStep1(new End().doc))
    expect(answer).not.toBeNull()
    if (answer) expect(isCatchUp(answer)).toBe(true)
  })

  test('asking what a room holds is not', () => {
    expect(isCatchUp(syncStep1(new End().doc))).toBe(false)
  })

  test('and neither is a message that cannot be read', () => {
    expect(isCatchUp(new Uint8Array())).toBe(false)
    expect(isCatchUp(new Uint8Array([0]))).toBe(false)
  })
})

describe('which messages would write', () => {
  test('an update would, and so would the answer carrying one', () => {
    const one = new End()
    const two = new End()
    one.text.insert(0, 'words\n')

    expect(isEdit(syncUpdate(Y.encodeStateAsUpdate(one.doc)))).toBe(true)

    const answer = one.hear(syncStep1(two.doc))
    expect(answer).not.toBeNull()
    if (answer) expect(isEdit(answer)).toBe(true)
  })

  test('asking what a room holds would not', () => {
    expect(isEdit(syncStep1(new End().doc))).toBe(false)
  })

  test('a caret would not', () => {
    const one = new End()
    one.awareness.setLocalStateField('who', { name: 'Ada', accent: 'violet' })

    expect(isEdit(awarenessUpdate(one.awareness, [one.doc.clientID]))).toBe(false)
  })

  test('and anything that cannot be read at all counts as one', () => {
    expect(isEdit(new Uint8Array([0]))).toBe(true)
    expect(isEdit(new Uint8Array())).toBe(true)
  })
})

describe('the sync messages a v2 device reads before it applies them', () => {
  test('a state vector, the answer, and an update read back as themselves', () => {
    const sv = new Uint8Array([1, 2, 3])
    const update = new Uint8Array([4, 5, 6, 7])

    expect(readSync(syncStep1Of(sv))).toEqual({ kind: 'step1', sv })
    expect(readSync(syncStep2Of(update))).toEqual({ kind: 'step2', update })
    expect(readSync(syncUpdate(update))).toEqual({ kind: 'update', update })
    expect(readSync(new Uint8Array([1, 2]))).toBeNull()
    expect(readSync(new Uint8Array([0, 9]))).toBeNull()
  })
})
