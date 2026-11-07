import { SharedDoc } from '@orden/editor'
import { TEXT } from '@orden/rooms'
import { beforeEach, describe, expect, test } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { rooms } from '../rooms.svelte'
import { bind } from '../rooms/bind'
import type { NoteDoc } from '../workspace/documents.svelte'
import { Mirrors } from './mirrors'
import { LiveRelay } from './relay'

const ID = 'n1'

function noteOf(key: string, words: string) {
  const live = new SharedDoc(words)
  return {
    key,
    path: 'Notes/plan.md',
    shared: null,
    kind: 'note',
    live,
    get latest() {
      return live.text.toString()
    },
  } as unknown as NoteDoc
}

class Device {
  live = new Y.Doc()
  awareness = new Awareness(this.live)
  readonly relay: LiveRelay
  readonly ups: { from: string; said: Record<string, unknown> }[] = []
  refusing = 0
  private readonly windows = new Map<string, Mirrors>()

  constructor(words: string) {
    this.live.getText(TEXT).insert(0, words)
    this.awareness.setLocalStateField('who', { name: 'Windows', accent: 'blue', id: 'u1' })
    this.relay = new LiveRelay((kind, what) => this.down(kind, what))
    this.relay.roomCame(ID, this.awareness)
  }

  window(name: string): Mirrors {
    const mirrors = new Mirrors({
      say: (kind, what) => {
        if (kind === 'live-up') {
          this.ups.push({ from: name, said: what })
          this.relay.up(name, what)
        }
        if (kind === 'live-want') {
          this.relay.want(name, what.ids as string[])
          this.follow()
        }
      },
      ask: (_what, args) => Promise.resolve(this.meet(name, args)),
      who: () => ({ name: 'Firefox', accent: 'green', id: 'u1', person: 'Emil' }),
      scheme: () => 'light',
    })
    this.windows.set(name, mirrors)
    return mirrors
  }

  replace(words: string) {
    this.live = new Y.Doc()
    this.live.getText(TEXT).insert(0, words)
    this.awareness = new Awareness(this.live)
    this.relay.roomCame(ID, this.awareness)
    this.follow()
  }

  follow() {
    this.relay.follow((id) => (id === ID ? this.live : null))
  }

  get words(): string {
    return this.live.getText(TEXT).toJSON()
  }

  private meet(from: string, args: Record<string, unknown>) {
    if (args.id !== ID) return null
    if (this.refusing > 0) {
      this.refusing -= 1
      return null
    }
    this.relay.meeting(from, ID)
    this.follow()
    return { gen: this.relay.genOf(ID), whole: Y.encodeStateAsUpdate(this.live) }
  }

  private down(kind: string, what: Record<string, unknown>) {
    for (const mirrors of this.windows.values()) {
      if (kind === 'live-down') mirrors.heard(what)
      if (kind === 'live-again') mirrors.again(what.id as string)
      if (kind === 'live-hello') mirrors.hello(what.id)
    }
  }
}

async function settled() {
  for (let round = 0; round < 50; round++) await Promise.resolve()
}

function type(note: NoteDoc, at: number, words: string) {
  note.live.edit([{ from: at, to: at, insert: words }])
}

beforeEach(() => {
  rooms.present = {}
  rooms.seen = {}
  rooms.carried.clear()
})

describe('a note open in a window that does not sync', () => {
  test('edits live through the one document the syncing window holds, and its own editor shows it', async () => {
    const device = new Device('# Plan\n')
    const note = noteOf('k1', '# Plan\n')
    device.window('w2').follow([{ key: 'k1', path: 'Notes/plan.md', note }], () => ID)
    await settled()

    const shown = new SharedDoc('# Plan\n')
    bind(shown, device.live.getText(TEXT), () => true)

    type(note, 7, 'typed in the second tab')
    expect(device.words).toBe('# Plan\ntyped in the second tab')
    expect(shown.text.toString()).toBe('# Plan\ntyped in the second tab')

    device.live.getText(TEXT).insert(0, 'from another device ')
    expect(note.latest).toBe('from another device # Plan\ntyped in the second tab')
  })

  test('takes the words the syncing window holds when its own file is behind', async () => {
    const device = new Device('# Plan\nnewer')
    const note = noteOf('k1', '# Plan\n')
    device.window('w2').follow([{ key: 'k1', path: 'Notes/plan.md', note }], () => ID)
    await settled()

    expect(note.latest).toBe('# Plan\nnewer')
    expect(device.words).toBe('# Plan\nnewer')
  })

  test('never doubles a word, however often a change is heard', async () => {
    const device = new Device('a')
    const one = noteOf('k1', 'a')
    const two = noteOf('k2', 'a')
    device.window('w2').follow([{ key: 'k1', path: 'Notes/plan.md', note: one }], () => ID)
    device.window('w3').follow([{ key: 'k2', path: 'Notes/plan.md', note: two }], () => ID)
    await settled()

    type(one, 1, 'b')
    type(two, 2, 'c')
    for (const { from, said } of [...device.ups]) device.relay.up(from, said)

    expect(device.words).toBe('abc')
    expect(one.latest).toBe('abc')
    expect(two.latest).toBe('abc')
  })

  test('shows its caret to the room and the room’s carets to it', async () => {
    const device = new Device('# Plan\n')
    const note = noteOf('k1', '# Plan\n')
    device.window('w2').follow([{ key: 'k1', path: 'Notes/plan.md', note }], () => ID)
    await settled()

    rooms.carried.get('k1')?.room.moved(2, 2)
    const theirs = [...device.awareness.getStates().entries()].filter(
      ([client]) => client !== device.live.clientID,
    )
    expect(theirs.some(([, state]) => (state as { caret?: unknown }).caret)).toBe(true)

    const remote = new Awareness(new Y.Doc())
    remote.setLocalStateField('who', { name: 'Mac', accent: 'red', id: 'u2', person: 'Ana' })
    applyAwarenessUpdate(device.awareness, encodeAwarenessUpdate(remote, [remote.clientID]), 'room')
    expect(rooms.seen.k1?.people.map((one) => one.key)).toEqual(['u2'])
  })

  test('meets again once a refused meeting may go, and keeps nothing heard meanwhile', async () => {
    const device = new Device('# Plan\n')
    device.refusing = 1
    const note = noteOf('k1', '# Plan\n')
    const window = device.window('w2')
    window.follow([{ key: 'k1', path: 'Notes/plan.md', note }], () => ID)
    await settled()
    device.live.getText(TEXT).insert(0, 'while apart ')
    window.unjoined()
    window.unjoined()
    await settled()

    type(note, note.latest.length, 'joined')
    expect(device.words).toBe('while apart # Plan\njoined')
    expect(note.latest).toBe('while apart # Plan\njoined')
  })

  test('takes its caret out of the room once the tab closes the note', async () => {
    const device = new Device('# Plan\n')
    const note = noteOf('k1', '# Plan\n')
    const window = device.window('w2')
    window.follow([{ key: 'k1', path: 'Notes/plan.md', note }], () => ID)
    await settled()
    rooms.carried.get('k1')?.room.moved(1, 1)
    expect(device.awareness.getStates().size).toBe(2)

    window.follow([], () => ID)
    expect(device.awareness.getStates().size).toBe(1)
    expect(device.relay.ids().size).toBe(0)
  })

  test('meets the new document when the old one is replaced, and old changes go nowhere', async () => {
    const device = new Device('old')
    const note = noteOf('k1', 'old')
    device.window('w2').follow([{ key: 'k1', path: 'Notes/plan.md', note }], () => ID)
    await settled()
    const stale = { ...device.ups.at(-1)?.said }

    device.replace('old')
    await settled()
    type(note, 3, '!')
    device.relay.up('w2', { ...stale, id: ID, update: Y.encodeStateAsUpdate(new Y.Doc()) })

    expect(device.words).toBe('old!')
    expect(note.latest).toBe('old!')
  })
})
