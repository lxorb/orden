/** The half of a room that is the same whatever the room is about.
 *
 *  A note and a canvas are both one file open on several devices, and almost
 *  everything about being in a room is the same for either: a socket that comes
 *  back when it goes, a Yjs document whose updates go out and whose arrivals come
 *  in, an awareness that says who is here, a greeting, and the moment the room has
 *  finished saying what it holds. That is all here.
 *
 *  What is not here is what the document holds and what to do when the room and
 *  this device disagree. A note settles that as one text; a canvas settles it
 *  object by object. Those are next door, in room.ts and plane.ts.
 *
 *  Nothing this device says goes out at once. A caret moves every few
 *  milliseconds while an arrow key is held and a pen reports a hundred points a
 *  second, and neither is something anybody can watch: what a device says about
 *  itself is coalesced into one message a frame, and the value is worked out when
 *  the message goes rather than when it was asked for, so what travels is where
 *  the hand is now. */

import { awarenessUpdate, forget, isCatchUp, receive, syncStep1, syncUpdate } from '@nib/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { RoomSocket } from './socket'

/** How long anything this device says about itself waits before it is sent. A
 *  caret that landed where somebody clicked is still announced well inside the
 *  time it takes to see it get there, and a held key or a moving pen costs one
 *  message rather than thirty. */
const SAY_DELAY = 40

/** Where an update arriving from the room is marked as having come from. */
const ROOM = 'room'

/** And where one made on this device is. Both rooms mark their own transactions
 *  with it, which is how neither of them echoes a change back the way it came and
 *  how an undo knows which changes were yours. */
export const HERE = 'here'

/** What this device calls itself in a room, and the colour it wears there. Both
 *  names travel; which one is drawn belongs to whoever is looking. See who.ts. */
export interface Who {
  name: string
  accent: string
  person?: string | undefined
}

export interface Opening {
  /** The file's id on the account, which is what names its room. */
  noteId: string
  token: string
  who: Who
  /** The room has finished saying what it holds, which is when this device's own
   *  copy may be compared with it. Runs once. */
  caughtUp: () => Promise<void> | void
  /** Somebody arrived, left, or moved. */
  present: () => void
}

export class RoomDoor {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)

  private readonly socket: RoomSocket
  /** Set once the room has said what it holds and this device has been brought
   *  together with it. */
  private settled = false
  /** Set the moment the room starts saying what it holds, so two answers landing
   *  together do not both bring this device together with it. */
  private greeted = false
  /** What this device has to say about itself and has not said yet, by field. The
   *  value is a function so that what goes out is worked out at the moment it
   *  goes: a caret is a position in the text as it now stands. */
  private saying = new Map<string, () => unknown>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opening: Opening) {
    this.socket = new RoomSocket(opening.noteId, opening.token, {
      opened: () => this.greet(),
      heard: (message) => void this.hear(message),
      closed: () => this.alone(),
    })

    this.awareness.setLocalStateField('who', opening.who)

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // An update that came out of the room is already in the room.
      if (origin !== ROOM) this.socket.send(syncUpdate(update))
    })

    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange) => {
      const changed = [...added, ...updated, ...removed]
      if (changed.length) this.socket.send(awarenessUpdate(this.awareness, changed))

      this.opening.present()
    })

    this.socket.start()
  }

  /** Whether the room has said what it holds, and this device's copy has been
   *  brought together with it. Until then the file is still the best answer
   *  anybody has; see rooms.svelte.ts. */
  get caughtUp(): boolean {
    return this.settled
  }

  /** Something this device wants the others to know: where its caret is, where its
   *  hand is, what it is drawing. Coalesced, and held back until there is a
   *  document to say it against - so a caret that moved while joining is sent the
   *  moment there is a text to place it in rather than lost. */
  announce(field: string, value: () => unknown) {
    this.saying.set(field, value)
    this.sayLater()
  }

  leave() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket.stop()
    this.awareness.destroy()
    this.doc.destroy()
  }

  /** One message a frame at most, with what to say worked out as it goes. */
  private sayLater() {
    if (this.timer || !this.settled || !this.saying.size) return

    this.timer = setTimeout(() => {
      this.timer = null
      const waiting = this.saying
      this.saying = new Map()
      for (const [name, held] of waiting) this.awareness.setLocalStateField(name, held())
    }, SAY_DELAY)
  }

  /** What this device says the moment the socket is up: what it holds, so the room
   *  can send back what it is missing, and who it is. */
  private greet() {
    this.socket.send(syncStep1(this.doc))

    // A room that was asleep has forgotten who is here, and this device has not:
    // saying it again is what puts the others' view of us back.
    if (this.awareness.getLocalState()) {
      this.socket.send(awarenessUpdate(this.awareness, [this.doc.clientID]))
    }
  }

  /** The connection went. Everybody else goes with it: where they are is no longer
   *  something this device knows. */
  private alone() {
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
    forget(this.awareness, others, 'gone')
  }

  private async hear(message: Uint8Array) {
    const answer = receive(message, this.doc, this.awareness, ROOM)
    if (answer) this.socket.send(answer)

    // The room has finished saying what it holds. Until now this device's own copy
    // has been left alone; this is where the two are brought together, once.
    if (this.greeted || !isCatchUp(message)) return

    this.greeted = true
    await this.opening.caughtUp()
    this.settled = true
    this.sayLater()
    this.opening.present()
  }
}

/** What the awareness protocol reports when its map changes. */
interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}
