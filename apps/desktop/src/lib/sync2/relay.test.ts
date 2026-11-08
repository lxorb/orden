import { SharedDoc } from '@orden/editor'
import { TEXT } from '@orden/rooms'
import { pushPlane, readPlane, seedPlane } from '@orden/rooms/plane'
import { beforeEach, describe, expect, test } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { type Canvas, type CanvasNode, emptyCanvas } from '../canvas/format'
import type { Hand, PlaneSurface, SharedPlane } from '../canvas/shared'
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
          this.relay.want(name, what.ids as string[], (what.meeting as string[] | undefined) ?? [])
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

  drawn(canvas: Canvas) {
    this.live = new Y.Doc()
    this.live.transact(() => seedPlane(this.live, canvas), 'room')
    this.awareness = new Awareness(this.live)
    this.relay.roomCame(ID, this.awareness)
    this.follow()
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

class Surface implements PlaneSurface {
  shared: SharedPlane | null = null
  hands: readonly Hand[] = []

  constructor(public canvas: Canvas) {}

  arrived(canvas: Canvas) {
    this.canvas = canvas
  }

  handsAre(hands: readonly Hand[]) {
    this.hands = hands
  }

  historyIs() {
    return undefined
  }

  edit(next: Canvas) {
    const before = this.canvas
    this.canvas = next
    this.shared?.push(before, next)
  }
}

function card(id: string): CanvasNode {
  return { id, type: 'text', x: 0, y: 0, width: 250, height: 60, text: id }
}

function board(...ids: string[]): Canvas {
  return { ...emptyCanvas(), nodes: ids.map(card) }
}

function drawingOf(key: string, surface: Surface) {
  rooms.planes.set(key, surface)
  return {
    key,
    path: 'Boards/plan.canvas',
    note: { key, path: 'Boards/plan.canvas', shared: null, kind: 'canvas' } as unknown as NoteDoc,
  }
}

beforeEach(() => {
  rooms.planes.clear()
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

describe('a canvas open in a window that does not sync', () => {
  test('draws live through the one document the syncing window holds, both ways', async () => {
    const device = new Device('')
    device.drawn(board('a'))
    const surface = new Surface(board('a'))
    device.window('w2').follow([drawingOf('k1', surface)], () => ID)
    await settled()

    expect(surface.shared).not.toBeNull()
    surface.edit(board('a', 'from the tab'))
    expect(readPlane(device.live).nodes.map((one) => one.id)).toEqual(['a', 'from the tab'])

    const there = readPlane(device.live)
    device.live.transact(() =>
      pushPlane(device.live, there, { ...there, nodes: [...there.nodes, card('b')] }),
    )
    expect(surface.canvas.nodes.map((one) => one.id)).toContain('b')
  })

  test('brings what it drew while apart into the document', async () => {
    const device = new Device('')
    device.drawn(board('a'))
    const surface = new Surface(board('a', 'drawn before'))
    device.window('w2').follow([drawingOf('k1', surface)], () => ID)
    await settled()

    expect(readPlane(device.live).nodes.map((one) => one.id)).toEqual(['a', 'drawn before'])
  })

  test('shows its hand to the room and the room’s hands to it, and lets go when closed', async () => {
    const device = new Device('')
    device.drawn(board('a'))
    const surface = new Surface(board('a'))
    const window = device.window('w2')
    window.follow([drawingOf('k1', surface)], () => ID)
    await settled()

    surface.shared?.hand({ x: 4, y: 5 }, null)
    const theirs = [...device.awareness.getStates().entries()].filter(
      ([client]) => client !== device.live.clientID,
    )
    expect(theirs.some(([, state]) => (state as { hand?: unknown }).hand)).toBe(true)

    const remote = new Awareness(new Y.Doc())
    remote.setLocalStateField('who', { name: 'Mac', accent: 'red', id: 'u2', person: 'Ana' })
    remote.setLocalStateField('hand', { x: 1, y: 2 })
    applyAwarenessUpdate(device.awareness, encodeAwarenessUpdate(remote, [remote.clientID]), 'room')
    expect(surface.hands.map((one) => one.at)).toEqual([{ x: 1, y: 2 }])

    rooms.planes.delete('k1')
    window.follow([], () => ID)
    expect(surface.shared).toBeNull()
    expect(surface.hands).toEqual([])
    expect(device.awareness.getStates().size).toBe(2)
  })
})

describe('two notes a window opens at once', () => {
  test('both stay live both ways when one joins while the other is still meeting', async () => {
    const lives = new Map([
      ['a', new Y.Doc()],
      ['b', new Y.Doc()],
    ])
    lives.get('a')?.getText(TEXT).insert(0, 'A')
    lives.get('b')?.getText(TEXT).insert(0, 'B')
    const windows: Mirrors[] = []
    const relay = new LiveRelay((kind, what) => {
      for (const one of windows) {
        if (kind === 'live-down') one.heard(what)
        if (kind === 'live-again') one.again(what.id as string)
      }
    })
    const follow = () => {
      for (const id of lives.keys()) {
        if (!relay.ids().has(id)) lives.set(id, copyOf(lives.get(id)))
      }
      relay.follow((id) => (relay.ids().has(id) ? (lives.get(id) ?? null) : null))
    }
    let letB: () => void = () => undefined
    const window = new Mirrors({
      say: (kind, what) => {
        if (kind === 'live-up') relay.up('w2', what)
        if (kind === 'live-want') {
          relay.want('w2', what.ids as string[], (what.meeting as string[] | undefined) ?? [])
          follow()
        }
      },
      ask: (_what, args) => {
        const id = args.id as string
        relay.meeting('w2', id)
        follow()
        const met = () => ({
          gen: relay.genOf(id),
          whole: Y.encodeStateAsUpdate(lives.get(id) ?? new Y.Doc()),
        })
        if (id === 'a') return Promise.resolve(met())
        const answer = met()
        return new Promise((resolve) => (letB = () => resolve(answer)))
      },
      who: () => ({ name: 'Firefox', accent: 'green', id: 'u1', person: 'Emil' }),
      scheme: () => 'light',
    })
    windows.push(window)
    const a = noteOf('ka', 'A')
    const b = noteOf('kb', 'B')
    window.follow(
      [
        { key: 'ka', path: 'Notes/a.md', note: a },
        { key: 'kb', path: 'Notes/b.md', note: b },
      ],
      (path) => (path === 'Notes/a.md' ? 'a' : 'b'),
    )
    await settled()
    lives.get('b')?.getText(TEXT).insert(1, ' meanwhile')
    letB()
    await settled()

    lives.get('b')?.getText(TEXT).insert(0, 'then ')
    type(b, b.latest.length, ' typed')
    expect(b.latest).toBe('then B meanwhile typed')
    expect(lives.get('b')?.getText(TEXT).toJSON()).toBe('then B meanwhile typed')
  })
})

function copyOf(doc: Y.Doc | undefined): Y.Doc {
  const out = new Y.Doc()
  if (doc) Y.applyUpdate(out, Y.encodeStateAsUpdate(doc))
  return out
}
