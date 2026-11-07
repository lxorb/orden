import { setPeers } from '@orden/editor'
import { TEXT } from '@orden/rooms'
import { fold } from '@orden/rooms/fold'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { rooms } from '../rooms.svelte'
import { bind } from '../rooms/bind'
import type { Who } from '../rooms/door'
import { roomKindOf } from '../rooms/kind'
import { peersIn, relative } from '../rooms/peers'
import type { Scheme } from '../theme.svelte'
import type { NoteDoc } from '../workspace/documents.svelte'

const LEADER = 'leader'

const MEETINGS = 8

export interface Line {
  say(kind: string, what: Record<string, unknown>): void
  ask(what: string, args: Record<string, unknown>): Promise<unknown>
  who(): Who
  scheme(): Scheme
}

interface Down {
  gen?: number
  update?: Uint8Array
  aware?: Uint8Array
}

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

function metOf(value: unknown): { gen: number; whole: Uint8Array } | null {
  if (typeof value !== 'object' || value === null) return null
  const { gen, whole } = value as Record<string, unknown>
  return typeof gen === 'number' && whole instanceof Uint8Array ? { gen, whole } : null
}

function downOf(said: Record<string, unknown>): Down {
  return {
    ...(typeof said.gen === 'number' ? { gen: said.gen } : {}),
    ...(said.update instanceof Uint8Array ? { update: said.update } : {}),
    ...(said.aware instanceof Uint8Array ? { aware: said.aware } : {}),
  }
}

export class Mirror {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  private unbind: (() => void) | null = null
  private gen: number | null = null
  private waiting: Down[] = []
  private left = false
  private asking = false
  private scheme: Scheme

  constructor(
    readonly key: string,
    readonly id: string,
    readonly note: NoteDoc,
    private readonly line: Line,
    private readonly settled: () => void,
  ) {
    this.scheme = line.scheme()
    this.awareness.setLocalStateField('who', line.who())
    this.doc.on('update', this.sendUpdate)
    this.awareness.on('update', this.sendAware)
    rooms.carried.set(key, { live: note.live, room: this })
  }

  get joined(): boolean {
    return this.unbind !== null
  }

  async meet(): Promise<void> {
    if (this.asking || this.joined) return
    this.asking = true
    try {
      await this.meeting()
    } finally {
      this.asking = false
      this.waiting = []
    }
    if (!this.gone()) this.settled()
  }

  private gone(): boolean {
    return this.left
  }

  private async meeting(): Promise<void> {
    for (let round = 0; round < MEETINGS && !this.gone(); round++) {
      const mine = this.note.latest
      const met = metOf(await this.line.ask('live-meet', { id: this.id, mine }))
      if (this.gone() || !met) return
      if (this.note.latest !== mine) continue
      this.gen = met.gen
      Y.applyUpdate(this.doc, met.whole, LEADER)
      for (const one of this.waiting.splice(0)) this.take(one)
      const text = this.doc.getText(TEXT)
      const change = fold(mine, text.toJSON())
      if (change) this.note.live.arrived([change])
      this.unbind = bind(this.note.live, text, () => !this.left)
      this.awareness.setLocalState(this.awareness.getLocalState())
      this.showPresent()
      return
    }
  }

  heard(said: Record<string, unknown>) {
    const down = downOf(said)
    if (this.gen !== null) this.take(down)
    else if (this.asking) this.waiting.push(down)
  }

  hello() {
    if (this.joined) this.awareness.setLocalState(this.awareness.getLocalState())
  }

  moved(anchor: number, head: number) {
    if (!this.joined) return
    const text = this.doc.getText(TEXT)
    this.awareness.setLocalStateField('caret', {
      anchor: relative(text, anchor),
      head: relative(text, head),
    })
  }

  repaint(scheme: Scheme) {
    if (scheme === this.scheme) return
    this.scheme = scheme
    this.showPresent()
  }

  rename(person: string | undefined) {
    this.awareness.setLocalStateField('who', { ...this.line.who(), person })
  }

  leave() {
    if (this.left) return
    this.left = true
    this.unbind?.()
    this.unbind = null
    this.awareness.destroy()
    this.awareness.off('update', this.sendAware)
    this.doc.off('update', this.sendUpdate)
    this.doc.destroy()
    this.note.live.announce([setPeers.of([])])
    if (rooms.carried.get(this.key)?.room === this) rooms.carried.delete(this.key)
    rooms.heard(this.key, 0)
  }

  private take(down: Down) {
    if (down.gen !== undefined && down.gen !== this.gen) return
    if (down.update) Y.applyUpdate(this.doc, down.update, LEADER)
    if (down.aware) applyAwarenessUpdate(this.awareness, down.aware, LEADER)
  }

  private readonly sendUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === LEADER || this.gen === null) return
    this.line.say('live-up', { id: this.id, gen: this.gen, update })
  }

  private readonly sendAware = ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
    if (origin !== 'local') {
      this.showPresent()
      return
    }
    const changed = [...added, ...updated, ...removed]
    if (!changed.length || this.gen === null) return
    this.line.say('live-up', {
      id: this.id,
      gen: this.gen,
      client: this.doc.clientID,
      aware: encodeAwarenessUpdate(this.awareness, changed),
    })
  }

  private showPresent() {
    if (this.left) return
    const { present, carets, seen } = peersIn(this.awareness, this.doc, this.scheme)
    this.note.live.announce([setPeers.of(this.joined ? carets : [])])
    rooms.heard(this.key, present, seen)
  }
}

export class Mirrors {
  private readonly held = new Map<string, Mirror>()
  private said = ''

  constructor(private readonly line: Line) {}

  follow(
    open: readonly { key: string; path: string | null; note: NoteDoc }[],
    idOf: (path: string) => string | null,
  ) {
    const wanted = new Map<string, { id: string; note: NoteDoc }>()
    for (const one of open) {
      if (!one.path || one.note.shared !== null || roomKindOf(one.note) !== 'words') continue
      const id = idOf(one.path)
      if (id) wanted.set(one.key, { id, note: one.note })
    }
    for (const [key, mirror] of this.held) {
      const still = wanted.get(key)
      if (still?.id === mirror.id && still.note === mirror.note) continue
      mirror.leave()
      this.held.delete(key)
    }
    for (const [key, one] of wanted) {
      if (this.held.has(key)) continue
      this.join(key, one.id, one.note)
    }
    this.tell()
  }

  again(id: string) {
    for (const [key, mirror] of this.held) {
      if (mirror.id !== id) continue
      mirror.leave()
      this.join(key, id, mirror.note)
    }
    this.tell()
  }

  unjoined() {
    for (const mirror of this.held.values()) void mirror.meet()
  }

  joins(key: string): boolean {
    return this.held.get(key)?.joined === true
  }

  heard(said: Record<string, unknown>) {
    for (const mirror of this.held.values()) if (mirror.id === said.id) mirror.heard(said)
  }

  hello(id: unknown) {
    for (const mirror of this.held.values()) if (mirror.id === id) mirror.hello()
  }

  restart() {
    for (const [key, mirror] of this.held) {
      mirror.leave()
      this.join(key, mirror.id, mirror.note)
    }
    this.said = ''
    this.tell()
  }

  clear() {
    for (const mirror of this.held.values()) mirror.leave()
    this.held.clear()
    this.said = ''
  }

  private join(key: string, id: string, note: NoteDoc) {
    const mirror = new Mirror(key, id, note, this.line, () => this.tell(true))
    this.held.set(key, mirror)
    void mirror.meet()
  }

  private tell(always = false) {
    const ids = [
      ...new Set([...this.held.values()].filter((one) => one.joined).map((one) => one.id)),
    ]
    const said = ids.sort().join(',')
    if (said === this.said && !always) return
    this.said = said
    this.line.say('live-want', { ids })
  }
}
