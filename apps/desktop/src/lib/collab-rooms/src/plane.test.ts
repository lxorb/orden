import { describe, expect, test, vi } from 'vitest'
import { receive, syncUpdate } from '@orden/rooms'
import { readPlane, seedPlane } from '@orden/rooms/plane'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { type Canvas, type CanvasNode, emptyCanvas } from '@orden/markdown/canvas'
import type { Hand, PlaneSurface, Reachable, SharedPlane } from '@orden/markdown/plane'

const sockets = vi.hoisted(() => {
  interface Wire {
    opened: () => void
    heard: (message: Uint8Array) => void
    closed: (code: number) => void
  }

  class FakeSocket {
    private sent: Uint8Array[] = []
    private up = false

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
    }
  }

  const opened: FakeSocket[] = []
  return { FakeSocket, opened }
})

vi.mock('./socket', () => ({ RoomSocket: sockets.FakeSocket }))

const { PlaneRoom } = await import('./plane')

class Server {
  readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)

  constructor(canvas: Canvas) {
    this.doc.transact(() => seedPlane(this.doc, canvas), 'room')
  }

  answer(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'socket')
  }

  elsewhere(canvas: Canvas, socket: InstanceType<typeof sockets.FakeSocket>) {
    const before = Y.encodeStateVector(this.doc)
    this.doc.transact(() => seedPlane(this.doc, canvas), 'socket')
    socket.wire.heard(syncUpdate(Y.encodeStateAsUpdate(this.doc, before)))
  }

  get plane(): Canvas {
    return readPlane(this.doc)
  }
}

class Surface implements PlaneSurface {
  canvas: Canvas
  shared: SharedPlane | null = null
  hands: readonly Hand[] = []
  reachable: Reachable = { undo: false, redo: false }
  arrivals = 0

  constructor(canvas: Canvas) {
    this.canvas = canvas
  }

  arrived(canvas: Canvas) {
    this.canvas = canvas
    this.arrivals++
  }

  handsAre(hands: readonly Hand[]) {
    this.hands = hands
  }

  historyIs(reachable: Reachable) {
    this.reachable = reachable
  }
}

function socketOf(): InstanceType<typeof sockets.FakeSocket> {
  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('the room opened no socket')

  return socket
}

function card(id: string, x = 0): CanvasNode {
  return { id, type: 'text', x, y: 0, width: 250, height: 60, text: id }
}

function drawn(...nodes: CanvasNode[]): Canvas {
  return { ...emptyCanvas(), nodes }
}

function carry(socket: InstanceType<typeof sockets.FakeSocket>, server: Server) {
  for (const message of socket.take()) {
    const back = server.answer(message)
    if (back) socket.wire.heard(back)
  }
}

function joining(file: Canvas, room: Canvas) {
  const surface = new Surface(file)
  const server = new Server(room)
  let arrivals = 0

  const plane = new PlaneRoom({
    noteId: 'c1',
    token: 'session',
    surface,
    who: { name: 'Mac', accent: 'blue' },
    scheme: 'dark',
    onPeers: () => undefined,
    gone: () => undefined,
    refused: () => undefined,
    shut: () => undefined,
    holds: () => arrivals === 0,
  })

  return {
    surface,
    server,
    room: plane,
    socket: socketOf(),
    moveOn: () => {
      arrivals += 1
    },
  }
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function inTheRoom(file: Canvas, room: Canvas) {
  const held = joining(file, room)
  held.socket.arrive()
  carry(held.socket, held.server)
  await settled()
  carry(held.socket, held.server)

  return held
}

function ids(canvas: Canvas): string[] {
  return canvas.nodes.map((node) => node.id)
}

describe('a canvas tab that has moved on to another file', () => {
  test('leaves the room it came from holding its own plane', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))
    expect(held.room.settled).toBe(true)

    held.moveOn()
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['a'])
  })

  test('does not push what is drawn in the new canvas into the old one’s room', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))

    held.moveOn()
    const before = held.surface.canvas
    held.surface.canvas = drawn(card('a'), card('b', 400))
    held.room.push(before, held.surface.canvas)
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['a'])
  })

  test('does not take the old canvas’s objects into the new one', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))
    const arrivals = held.surface.arrivals

    held.moveOn()

    held.server.elsewhere(drawn(card('a'), card('elsewhere', 800)), held.socket)
    carry(held.socket, held.server)

    expect(ids(held.surface.canvas)).toEqual(['a'])
    expect(held.surface.arrivals).toBe(arrivals)
  })

  test('takes nothing back either, an undo being an edit like any other', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))

    const before = held.surface.canvas
    held.surface.canvas = drawn(card('a'), card('b', 400))
    held.room.push(before, held.surface.canvas)
    carry(held.socket, held.server)
    expect(ids(held.server.plane)).toEqual(['a', 'b'])

    held.moveOn()

    expect(held.room.undo()).toBe(false)
    expect(held.room.redo()).toBe(false)
    carry(held.socket, held.server)
    expect(ids(held.server.plane)).toEqual(['a', 'b'])
  })
})

describe('a room answering after the tab has moved on', () => {
  test('neither merges the two planes nor hands the surface the room', async () => {
    const held = joining(drawn(card('mine')), drawn(card('theirs')))
    held.socket.arrive()

    held.moveOn()
    carry(held.socket, held.server)
    await settled()
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['theirs'])
    expect(ids(held.surface.canvas)).toEqual(['mine'])
    expect(held.surface.shared).toBeNull()
  })

  test('a room that has been left carries nothing at all', async () => {
    const held = joining(drawn(card('mine')), drawn(card('theirs')))
    held.socket.arrive()

    held.room.leave()
    carry(held.socket, held.server)
    await settled()
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['theirs'])
    expect(held.surface.shared).toBeNull()
  })
})

describe('a canvas whose tab has not moved on', () => {
  test('merges both planes, keeping what each side had', async () => {
    const held = await inTheRoom(drawn(card('mine')), drawn(card('theirs', 400)))

    expect(ids(held.surface.canvas).sort()).toEqual(['mine', 'theirs'])
    expect(held.surface.shared).not.toBeNull()
  })

  test('and every edit made here reaches the room', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))

    const before = held.surface.canvas
    held.surface.canvas = drawn(card('a'), card('b', 400))
    held.room.push(before, held.surface.canvas)
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['a', 'b'])
  })

  test('and what another device draws reaches the surface', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))

    held.server.elsewhere(drawn(card('a'), card('theirs', 400)), held.socket)
    carry(held.socket, held.server)

    expect(ids(held.surface.canvas).sort()).toEqual(['a', 'theirs'])
  })
})
