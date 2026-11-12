import { awarenessUpdate, forget, isCatchUp, receive, syncStep1, syncUpdate } from '@orden/rooms'
import { NOW_READS, shutOut, SIGNED_OUT } from '@orden/sync-core'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { RoomSocket } from './socket'

const SAY_DELAY = 40

export const ROOM = 'room'

export const HERE = 'here'

const REBUILT = 1012

const TOO_LARGE = 1009

export interface Who {
  name: string
  accent: string
  person?: string | undefined
  id?: string | undefined
  face?: string | undefined
}

export interface Opening {
  noteId: string
  token: string
  who: Who
  caughtUp: () => Promise<void> | void
  present: () => void
  gone: () => void
  refused: (said: string) => void
  shut: (signedOut: boolean) => void
  demoted: () => void
}

export class RoomDoor {
  readonly awareness: Awareness

  private who: Who
  protected readonly socket: RoomSocket
  protected settled = false
  protected greeted = false
  private saying = new Map<string, () => unknown>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    protected readonly opening: Opening,
    readonly doc: Y.Doc = new Y.Doc(),
    offers: readonly string[] = [],
  ) {
    const own = new Y.Doc()
    own.clientID = this.doc.clientID
    this.awareness = new Awareness(own)
    this.who = opening.who
    this.socket = new RoomSocket(
      opening.noteId,
      opening.token,
      {
        opened: () => this.greet(),
        heard: (message) => void this.hear(message),
        closed: (code, said) => this.went(code, said),
      },
      offers,
    )

    this.awareness.setLocalStateField('who', this.who)

    this.doc.on('update', this.sendOut)

    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange) => {
      const changed = [...added, ...updated, ...removed]
      if (changed.length) this.socket.send(awarenessUpdate(this.awareness, changed))

      this.opening.present()
    })

    this.socket.start()
  }

  get caughtUp(): boolean {
    return this.settled && this.socket.open
  }

  announce(field: string, value: () => unknown) {
    this.saying.set(field, value)
    this.sayLater()
  }

  rename(person: string | undefined) {
    if (person === this.who.person) return

    this.who =
      person === undefined
        ? { name: this.who.name, accent: this.who.accent }
        : { ...this.who, person }
    this.awareness.setLocalStateField('who', this.who)
  }

  leave() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket.stop()
    this.awareness.destroy()
    this.doc.off('update', this.sendOut)
    this.dropped()
  }

  protected dropped() {
    this.doc.destroy()
  }

  private readonly sendOut = (update: Uint8Array, origin: unknown) => {
    if (origin !== ROOM && this.sending()) this.socket.send(syncUpdate(update))
  }

  protected sending(): boolean {
    return true
  }

  protected sayLater() {
    if (this.timer || !this.settled || !this.saying.size) return

    this.timer = setTimeout(() => {
      this.timer = null
      const waiting = this.saying
      this.saying = new Map()
      for (const [name, held] of waiting) this.awareness.setLocalStateField(name, held())
    }, SAY_DELAY)
  }

  protected greet() {
    this.socket.send(this.question())

    const here = this.awareness.getLocalState()
    if (here) this.awareness.setLocalState(here)
  }

  protected went(code: number, said: string) {
    if (code === REBUILT) {
      this.socket.stop()
      this.opening.gone()
      return
    }

    if (shutOut(code)) {
      this.socket.stop()
      this.alone()
      this.opening.shut(code === SIGNED_OUT)
      return
    }

    if (code === NOW_READS) {
      this.socket.stop()
      this.alone()
      this.opening.demoted()
      return
    }

    if (code === TOO_LARGE) {
      this.socket.stop()
      this.alone()
      this.opening.refused(said)
      return
    }

    this.alone()
  }

  protected alone() {
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
    forget(this.awareness, others, 'gone')
  }

  protected question(): Uint8Array {
    return syncStep1(this.doc)
  }

  protected async hear(message: Uint8Array) {
    const answer = receive(message, this.doc, this.awareness, ROOM)
    if (answer) this.socket.send(answer)

    if (this.greeted || !isCatchUp(message)) return

    this.greeted = true
    await this.together()
  }

  protected async together() {
    await this.opening.caughtUp()
    this.settled = true
    this.sayLater()
    this.opening.present()
  }
}

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}
