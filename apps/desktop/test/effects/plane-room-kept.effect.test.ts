import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { emptyCanvas, writeCanvas } from '@orden/markdown/canvas'
import { emptyPages } from '@orden/markdown/pages'
import { awarenessUpdate, receive } from '@orden/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import Canvas from '../../src/lib/canvas/src/Canvas.svelte'
import Pages from '../../src/lib/pages/src/Pages.svelte'
import { CanvasStore } from '../../src/lib/canvas/src/store.svelte'
import { tools } from '../../src/lib/canvas/src/tools.svelte'
import { rooms } from '../../src/lib/collab/src/api'
import { account } from '../../src/lib/accounts/src/api'
import { NoteDoc, Tab } from '../../src/lib/documents/src/api'
import { idle } from './settle'

const sockets = vi.hoisted(() => {
  interface Wire {
    opened: () => void
    heard: (message: Uint8Array) => void
    closed: (code: number, said: string) => void
  }

  class FakeSocket {
    private sent: Uint8Array[] = []
    private up = false
    stopped = false

    constructor(
      readonly noteId: string,
      readonly token: string,
      readonly wire: Wire,
    ) {
      opened.push(this)
    }

    get open(): boolean {
      return this.up
    }

    arrive() {
      this.up = true
      this.wire.opened()
    }

    take(): Uint8Array[] {
      const said = this.sent
      this.sent = []
      return said
    }

    start() {
      // The real one connects here; this one waits to be told it is up.
    }

    send(message: Uint8Array): boolean {
      if (!this.up) return false

      this.sent.push(message)
      return true
    }

    stop() {
      this.up = false
      this.stopped = true
    }
  }

  const opened: FakeSocket[] = []
  return { FakeSocket, opened }
})

vi.mock('../../src/lib/collab-rooms/src/socket', () => ({ RoomSocket: sockets.FakeSocket }))

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.hasPointerCapture = () => false
type Socket = InstanceType<typeof sockets.FakeSocket>

const surfaces = {
  canvas: { shown: Canvas, path: '/space/Board.canvas', text: writeCanvas(emptyCanvas()) },
  pages: { shown: Pages, path: '/space/Notes.pages', text: writeCanvas(emptyPages('a4')) },
} as const

let host: HTMLElement
let close = () => undefined

beforeAll(async () => {
  await rooms.reach()
})

beforeEach(() => {
  tools.choose('draw')
  sockets.opened.length = 0
  account.token = 'session'
  account.user = { id: 'drawer', email: 'drawer@example.com', name: null }
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  close()
  rooms.clear()
  host.remove()
  account.user = null
  account.token = null
})

function carry(socket: Socket, doc: Y.Doc, awareness: Awareness) {
  for (const message of socket.take()) {
    const back = receive(message, doc, awareness, 'socket')
    if (back) socket.wire.heard(back)
  }
}

async function onThePlane(kind: keyof typeof surfaces): Promise<{ socket: Socket; tab: Tab }> {
  const { shown, path, text } = surfaces[kind]
  const note = new NoteDoc({ kind, path, name: path.split('/').at(-1) ?? path, text, dirty: false }, () => undefined)
  const tab = new Tab(note, 'pane')
  rooms.follow([{ key: note.key, noteId: 'plane-1', note, hash: null, version: 1 }])

  const mounted = mount(shown, { target: host, props: { tab, focused: true } })
  close = () => void unmount(mounted)
  flushSync()

  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('the plane did not join its room')

  const doc = new Y.Doc()
  const server = new Awareness(doc)
  socket.arrive()
  carry(socket, doc, server)
  await vi.waitFor(() => expect(rooms.carries('plane-1'), 'the room to catch up').toBe(true), {
    timeout: 10_000,
  })

  const phone = new Awareness(new Y.Doc())
  phone.setLocalState({ who: { name: 'Phone', accent: 'blue' }, hand: { x: 40, y: 60 } })
  socket.wire.heard(awarenessUpdate(phone, [phone.clientID]))
  flushSync()

  return { socket, tab }
}

function handsOn(tab: Tab): string[] {
  return (CanvasStore.drawing(tab.note, [tab])?.hands ?? []).map((one) => one.name)
}

test.each([
  ['a canvas', 'canvas'],
  ['a page note', 'pages'],
] as const)(
  '%s stays in its room, still showing the other device’s hand, when the account is read again',
  async (_, kind) => {
    const { socket, tab } = await onThePlane(kind)
    expect(handsOn(tab)).toEqual(['Phone'])

    account.user = { id: 'drawer', email: 'drawer@example.com', name: null }
    flushSync()
    await idle(5)
    flushSync()

    expect(sockets.opened).toHaveLength(1)
    expect(socket.stopped).toBe(false)
    expect(handsOn(tab)).toEqual(['Phone'])
    expect(host.querySelector('svg.hands text')?.textContent).toBe('Phone')
  },
)
