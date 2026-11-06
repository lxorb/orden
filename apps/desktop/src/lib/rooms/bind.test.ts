import { describe, expect, test } from 'vitest'
import { EditorState, SharedDoc, type Text } from '@orden/editor'
import { TEXT } from '@orden/rooms'
import * as Y from 'yjs'
import { bind, replace, replacements } from './bind'
import { type Base, meeting } from './join'

interface Work {
  covered: number
  calls: number
  characters: number
  whole: number
}

class Device {
  readonly note: SharedDoc
  readonly doc = new Y.Doc()
  readonly text = this.doc.getText(TEXT)
  private unbind: () => void = () => undefined

  private constructor(file: string) {
    this.note = new SharedDoc(file)
  }

  static opening(file: string): Device {
    const device = new Device(file)
    device.doc.transact(() => device.text.insert(0, file), 'room')
    device.arrive(file, { mine: true, theirs: true })
    return device
  }

  static joining(room: Device, file: string, base: Base = { mine: true, theirs: false }): Device {
    const device = new Device(file)
    Y.applyUpdate(device.doc, Y.encodeStateAsUpdate(room.doc), 'room')
    device.arrive(file, base)
    return device
  }

  private arrive(file: string, base: Base) {
    const met = meeting(file, this.text.toJSON(), base)
    if (met.kind === 'apart') throw new Error('this device and the room are apart')

    if (met.kind === 'take') this.note.arrived([met.change])
    else if (met.kind === 'offer') this.doc.transact(() => replace(this.text, met.change), 'here')

    this.unbind = bind(this.note, this.text, () => true)
  }

  get words(): string {
    return this.note.text.toString()
  }

  get shared(): string {
    return this.text.toJSON()
  }

  type(at: number, words: string) {
    this.note.edit([{ from: at, to: at, insert: words }])
  }

  watch(): Work {
    const work: Work = { covered: 0, calls: 0, characters: 0, whole: 0 }

    const reported = this.note.onLocal
    this.note.onLocal = (changes) => {
      changes.iterChanges((fromA, toA, fromB, toB) => {
        work.covered += toA - fromA + (toB - fromB)
      })
      reported?.(changes)
    }

    const inserted = this.text.insert.bind(this.text)
    this.text.insert = (at: number, words: string) => {
      work.calls += 1
      work.characters += words.length
      inserted(at, words)
    }

    const removed = this.text.delete.bind(this.text)
    this.text.delete = (at: number, count: number) => {
      work.calls += 1
      work.characters += count
      removed(at, count)
    }

    const asJson = this.text.toJSON.bind(this.text)
    this.text.toJSON = () => {
      work.whole += 1
      return asJson()
    }

    const asString = this.text.toString.bind(this.text)
    this.text.toString = () => {
      work.whole += 1
      return asString()
    }

    const held = Object.getOwnPropertyDescriptor(SharedDoc.prototype, 'text')
    const reading = held?.get?.bind(this.note)
    if (!reading) throw new Error('a shared document with no text to watch')

    Object.defineProperty(this.note, 'text', {
      configurable: true,
      get: () => {
        work.whole += 1
        return reading() as Text
      },
    })

    return work
  }

  cut(from: number, to: number) {
    this.note.edit([{ from, to, insert: '' }])
  }

  updateFor(other: Device): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(other.doc))
  }

  hear(update: Uint8Array) {
    Y.applyUpdate(this.doc, update, 'room')
  }

  close() {
    this.unbind()
  }
}

function exchange(one: Device, two: Device) {
  const forOne = two.updateFor(one)
  const forTwo = one.updateFor(two)

  one.hear(forOne)
  two.hear(forTwo)
}

function pane() {
  return { state: EditorState.create({ doc: '' }), dispatch: () => undefined }
}

describe('a note bound to a room', () => {
  test('puts what was typed into the shared text', () => {
    const one = Device.opening('# Note\n')
    one.type(7, 'a line\n')

    expect(one.shared).toBe('# Note\na line\n')
    one.close()
  })

  test('opens a joining device on the words the room already holds', () => {
    const one = Device.opening('# Note\nwritten first\n')
    const two = Device.joining(one, '# Note\nwritten first\n')

    expect(two.words).toBe('# Note\nwritten first\n')
    expect(two.shared).toBe(two.words)
    one.close()
    two.close()
  })

  test('puts what the room says into the note', () => {
    const one = Device.opening('# Note\n')
    const two = Device.joining(one, '# Note\n')

    two.type(7, 'from two\n')
    one.hear(two.updateFor(one))

    expect(one.words).toBe('# Note\nfrom two\n')
    expect(one.words).toBe(two.words)
    one.close()
    two.close()
  })

  test('keeps both when two devices write in the same place at once', () => {
    const one = Device.opening('start\n')
    const two = Device.joining(one, 'start\n')

    one.type(6, 'one\n')
    two.type(6, 'two\n')
    exchange(one, two)

    expect(one.words).toBe(two.words)
    expect(one.shared).toBe(one.words)
    expect(one.words).toContain('one')
    expect(one.words).toContain('two')
    expect(one.words).toMatch(/start\n(one\ntwo\n|two\none\n)/)
    one.close()
    two.close()
  })

  test('keeps every edit when both wrote while they were apart', () => {
    const one = Device.opening('# Together\n')
    const two = Device.joining(one, '# Together\n')

    one.type(11, 'here one\n')
    one.type(20, 'here two\n')
    two.type(11, 'there one\n')
    two.type(0, 'top\n')

    exchange(one, two)

    expect(one.words).toBe(two.words)
    for (const words of ['here one', 'here two', 'there one', 'top']) {
      expect(one.words).toContain(words)
    }
    one.close()
    two.close()
  })

  test('settles a delete against an insert in the same paragraph', () => {
    const one = Device.opening('alpha beta gamma\n')
    const two = Device.joining(one, 'alpha beta gamma\n')

    one.cut(6, 11)
    two.type(16, ' delta')
    exchange(one, two)

    expect(one.words).toBe(two.words)
    expect(one.words).toBe('alpha gamma delta\n')
    one.close()
    two.close()
  })

  test('agrees whichever order the updates arrive in', () => {
    const held: string[] = []

    for (const swapped of [false, true]) {
      const one = Device.opening('one\ntwo\nthree\n')
      const two = Device.joining(one, 'one\ntwo\nthree\n')
      const three = Device.joining(one, 'one\ntwo\nthree\n')

      one.type(4, 'A')
      two.type(8, 'B')
      three.cut(0, 4)

      const updates = [two.updateFor(one), three.updateFor(one)]
      for (const update of swapped ? [...updates].reverse() : updates) one.hear(update)

      held.push(one.words)
      for (const device of [one, two, three]) device.close()
    }

    expect(held[0]).toBe(held[1])
  })

  test('folds in a note written while the device was closed', () => {
    const one = Device.opening('# Journal\nmonday\n')

    const two = Device.joining(one, '# Journal\nmonday\ntuesday\n', {
      mine: false,
      theirs: true,
    })

    expect(two.shared).toBe('# Journal\nmonday\ntuesday\n')
    one.hear(two.updateFor(one))
    expect(one.words).toBe('# Journal\nmonday\ntuesday\n')
    one.close()
    two.close()
  })

  test('takes the room&apos;s words when its own file is untouched', () => {
    const one = Device.opening('# Journal\nmonday\ntuesday\n')
    const two = Device.joining(one, '# Journal\nmonday\n')

    expect(two.words).toBe('# Journal\nmonday\ntuesday\n')
    expect(two.shared).toBe(two.words)
    one.close()
    two.close()
  })

  test('undoes what you wrote and never what the other device wrote', () => {
    const one = Device.opening('base\n')
    const two = Device.joining(one, 'base\n')

    one.type(5, 'mine\n')
    two.type(5, 'theirs\n')
    exchange(one, two)

    expect(one.words).toContain('mine')
    expect(one.words).toContain('theirs')

    expect(one.note.undo(pane())).toBe(true)
    expect(one.words).not.toContain('mine')
    expect(one.words).toContain('theirs')

    expect(one.note.undo(pane())).toBe(false)
    one.close()
    two.close()
  })

  test('leaves the note where it is when the binding is undone', () => {
    const one = Device.opening('words\n')
    one.close()

    one.type(6, 'after\n')

    expect(one.words).toBe('words\nafter\n')
    expect(one.shared).toBe('words\n')
  })
})

describe('an edit that lands between the halves of one character', () => {
  const grin = '\u{1f600}'
  const beam = '\u{1f601}'

  function afterwards(words: string, edit: (device: Device) => void) {
    const one = Device.opening(words)
    const two = Device.joining(one, words)
    edit(one)
    exchange(one, two)
    return { note: one.words, room: one.shared, there: two.words }
  }

  test('keeps the character whole and what was typed beside it', () => {
    const held = afterwards(`a${grin}b`, (device) => device.type(2, 'x'))

    expect(held).toEqual({ note: `a${grin}xb`, room: `a${grin}xb`, there: `a${grin}xb` })
  })

  test('takes the whole character when one half of it is deleted', () => {
    expect(afterwards(`a${grin}b`, (device) => device.cut(1, 2))).toEqual({
      note: 'ab',
      room: 'ab',
      there: 'ab',
    })
    expect(afterwards(`a${grin}b`, (device) => device.cut(2, 3))).toEqual({
      note: 'ab',
      room: 'ab',
      there: 'ab',
    })
  })

  test('does not carry half of one that was written', () => {
    const held = afterwards('ab', (device) => device.type(0, '\uD83D'))

    expect(held).toEqual({ note: 'ab', room: 'ab', there: 'ab' })
  })

  test('carries a character changed by its second half alone', () => {
    const held = afterwards(`a${grin}b`, (device) => {
      device.note.edit([{ from: 2, to: 3, insert: beam.slice(1) }])
    })

    expect(held).toEqual({ note: `a${beam}b`, room: `a${beam}b`, there: `a${beam}b` })
  })
})

describe('a keystroke in a note that is in a room', () => {
  function perKeystroke(size: number): Work {
    const words = 'the room settles two versions of one paragraph. '.repeat(Math.ceil(size / 48))
    const device = Device.opening(words.slice(0, size))
    const at = Math.floor(size / 2)
    const work = device.watch()

    for (let round = 0; round < 100; round++) device.type(at + round, 'x')

    device.close()
    return work
  }

  test('costs the keystroke and not the note', () => {
    const small = perKeystroke(2_048)
    const large = perKeystroke(200_000)

    expect(small).toEqual({ covered: 100, calls: 100, characters: 100, whole: 0 })

    expect(large).toEqual(small)
  })
})

describe('a device meeting the room it joined', () => {
  const roomAhead: Base = { mine: true, theirs: false }
  const deviceAhead: Base = { mine: false, theirs: true }
  const apart: Base = { mine: false, theirs: false }

  test('has nothing to do when the two agree', () => {
    expect(meeting('same', 'same', roomAhead)).toEqual({ kind: 'agreed' })
    expect(meeting('same', 'same', apart)).toEqual({ kind: 'agreed' })
  })

  test('takes the room&apos;s words when the file is untouched', () => {
    expect(meeting('one\n', 'one\ntwo\n', roomAhead)).toEqual({
      kind: 'take',
      change: { from: 4, to: 4, insert: 'two\n' },
    })
  })

  test('offers its own when the file has been written in and the room has not', () => {
    expect(meeting('one\ntwo\n', 'one\n', deviceAhead)).toEqual({
      kind: 'offer',
      change: { from: 4, to: 4, insert: 'two\n' },
    })
  })

  test('never empties a file for a room that holds nothing', () => {
    expect(meeting('words\n', '', roomAhead)).toEqual({
      kind: 'offer',
      change: { from: 0, to: 0, insert: 'words\n' },
    })
  })

  test('never empties a room for a document that holds nothing', () => {
    expect(meeting('', 'words\n', apart)).toEqual({
      kind: 'take',
      change: { from: 0, to: 0, insert: 'words\n' },
    })
  })

  test('takes the room&apos;s words for a file the account never handed over', () => {
    expect(meeting('one\n', 'one\ntwo\n', null)).toEqual({
      kind: 'take',
      change: { from: 4, to: 4, insert: 'two\n' },
    })
  })

  test('writes over neither when both have moved since the words they shared', () => {
    expect(meeting('shared\nmine\n', 'shared\ntheirs\n', apart)).toEqual({ kind: 'apart' })
  })
})

describe('a delta read as the edits it is', () => {
  test('reads an insertion', () => {
    expect(replacements([{ retain: 4 }, { insert: 'new' }])).toEqual([
      { from: 4, to: 4, insert: 'new' },
    ])
  })

  test('reads a deletion', () => {
    expect(replacements([{ retain: 2 }, { delete: 3 }])).toEqual([{ from: 2, to: 5, insert: '' }])
  })

  test('reads a delete and the insert after it as one replacement', () => {
    expect(replacements([{ retain: 1 }, { delete: 2 }, { insert: 'xy' }])).toEqual([
      { from: 1, to: 3, insert: 'xy' },
    ])
  })

  test('reads an insert and the delete after it as one replacement', () => {
    expect(replacements([{ retain: 1 }, { insert: 'xy' }, { delete: 2 }])).toEqual([
      { from: 1, to: 3, insert: 'xy' },
    ])
  })

  test('reads several edits, each in the positions the note held before any', () => {
    expect(
      replacements([{ retain: 2 }, { insert: 'a' }, { retain: 3 }, { delete: 1 }, { insert: 'b' }]),
    ).toEqual([
      { from: 2, to: 2, insert: 'a' },
      { from: 5, to: 6, insert: 'b' },
    ])
  })

  test('skips what a note made of plain text never carries', () => {
    expect(replacements([{ retain: 1 }, { insert: { embedded: true } }])).toEqual([])
  })
})
