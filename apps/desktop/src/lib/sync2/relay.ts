import {
  type Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import * as Y from 'yjs'
import { MINE } from './docs'

const RELAYED = 'relayed'

type Say = (kind: string, what: Record<string, unknown>) => void

interface Hooked<T> {
  on: T
  gen: number
  off: () => void
}

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

export class LiveRelay {
  private readonly wants = new Map<string, Set<string>>()
  private readonly joins = new Map<string, Set<string>>()
  private readonly clients = new Map<string, Map<string, number>>()
  private readonly lives = new Map<string, Hooked<Y.Doc>>()
  private readonly heard = new Map<string, Hooked<Awareness>>()
  private readonly rooms = new Map<string, Awareness>()
  private made = 0
  private readonly gens = new WeakMap<Y.Doc, number>()

  constructor(private readonly say: Say) {}

  ids(): Set<string> {
    const all = new Set<string>()
    for (const ids of this.wants.values()) for (const id of ids) all.add(id)
    return all
  }

  joined(from: string, id: string): boolean {
    return this.joins.get(from)?.has(id) === true
  }

  genOf(id: string): number | null {
    return this.lives.get(id)?.gen ?? null
  }

  want(from: string, ids: readonly string[]): boolean {
    const had = this.wants.get(from) ?? new Set<string>()
    const now = new Set(ids)
    for (const id of had) if (!now.has(id)) this.forgetClient(from, id)
    if (now.size) this.wants.set(from, now)
    else this.wants.delete(from)
    if (now.size) this.joins.set(from, new Set(now))
    else this.joins.delete(from)
    return had.size !== now.size || [...now].some((id) => !had.has(id))
  }

  meeting(from: string, id: string): boolean {
    const had = this.wants.get(from) ?? new Set<string>()
    if (had.has(id)) return false
    this.wants.set(from, new Set([...had, id]))
    return true
  }

  gone(from: string): boolean {
    const had = this.wants.get(from)
    if (!had) return false
    for (const id of had) this.forgetClient(from, id)
    this.wants.delete(from)
    this.joins.delete(from)
    this.clients.delete(from)
    return true
  }

  roomCame(id: string, awareness: Awareness) {
    this.rooms.set(id, awareness)
  }

  roomsHeld(ids: ReadonlySet<string>) {
    for (const id of this.rooms.keys()) if (!ids.has(id)) this.rooms.delete(id)
  }

  follow(liveOf: (id: string) => Y.Doc | null) {
    const ids = this.ids()
    const again: string[] = []
    for (const [id, held] of this.lives) {
      if (ids.has(id) && liveOf(id) === held.on) continue
      held.off()
      this.lives.delete(id)
      if (ids.has(id)) again.push(id)
    }
    for (const id of ids) {
      const live = liveOf(id)
      if (!this.lives.has(id) && live) this.hookLive(id, live)
    }
    for (const [id, held] of this.heard) {
      if (ids.has(id) && this.rooms.get(id) === held.on) continue
      held.off()
      this.heard.delete(id)
    }
    const hello: string[] = []
    for (const id of ids) {
      const awareness = this.rooms.get(id)
      if (this.heard.has(id) || !awareness) continue
      this.hookAwareness(id, awareness)
      hello.push(id)
    }
    for (const id of again) this.say('live-again', { id })
    for (const id of hello) this.say('live-hello', { id })
  }

  up(from: string, said: Record<string, unknown>) {
    const id = said.id
    if (typeof id !== 'string' || !this.wants.get(from)?.has(id)) return
    const live = this.lives.get(id)
    if (!live || said.gen !== live.gen) return
    if (isBytes(said.update)) Y.applyUpdate(live.on, said.update, MINE)
    const heard = this.heard.get(id)
    if (!heard || !isBytes(said.aware) || typeof said.client !== 'number') return
    const clients = this.clients.get(from) ?? new Map<string, number>()
    clients.set(id, said.client)
    this.clients.set(from, clients)
    applyAwarenessUpdate(heard.on, said.aware, RELAYED)
  }

  stop() {
    for (const one of this.lives.values()) one.off()
    for (const one of this.heard.values()) one.off()
    this.lives.clear()
    this.heard.clear()
    this.rooms.clear()
    this.wants.clear()
    this.joins.clear()
    this.clients.clear()
  }

  private forgetClient(from: string, id: string) {
    const client = this.clients.get(from)?.get(id)
    if (client === undefined) return
    this.clients.get(from)?.delete(id)
    const heard = this.heard.get(id)
    if (heard) removeAwarenessStates(heard.on, [client], RELAYED)
  }

  private hookLive(id: string, live: Y.Doc) {
    const gen = this.gens.get(live) ?? ++this.made
    this.gens.set(live, gen)
    const said = (update: Uint8Array) => this.say('live-down', { id, gen, update })
    live.on('update', said)
    this.lives.set(id, { on: live, gen, off: () => live.off('update', said) })
  }

  private hookAwareness(id: string, awareness: Awareness) {
    const said = ({ added, updated, removed }: AwarenessChange) => {
      const changed = [...added, ...updated, ...removed]
      if (changed.length) {
        this.say('live-down', { id, aware: encodeAwarenessUpdate(awareness, changed) })
      }
    }
    awareness.on('update', said)
    this.heard.set(id, { on: awareness, gen: 0, off: () => awareness.off('update', said) })
    const known = [...awareness.getStates().keys()]
    if (known.length) this.say('live-down', { id, aware: encodeAwarenessUpdate(awareness, known) })
  }
}
