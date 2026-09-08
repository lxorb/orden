/** One open note, joined to the room the other devices are in.
 *
 *  The document is a Yjs one and the note's words are a `Y.Text` in it. Typing
 *  goes into that text and out over the socket; what comes back goes into the
 *  note. Neither side waits for the other: a keystroke is drawn by the editor that
 *  took it, which is what keeps typing feeling like typing, and the room is where
 *  two versions of the same paragraph are settled.
 *
 *  The moment worth reading carefully is joining. The document starts empty and is
 *  filled by the room, with the note left alone until that has happened - so what
 *  the room holds and what this device's file holds can be compared rather than
 *  one silently landing on the other. Which of the two is news is decided by a
 *  single question: is the file still exactly what the account last handed this
 *  device? If it is, everything that differs was written elsewhere and the room's
 *  words go into the note. If it is not, this device wrote while it was away, and
 *  what it wrote goes into the room as the edit it was. Neither case loses a word,
 *  and neither leaves a second file to go and find. */

import { setPeers, type SharedDoc } from '@nib/editor'
import {
  awarenessUpdate,
  forget,
  isCatchUp,
  receive,
  syncStep1,
  syncUpdate,
  TEXT,
} from '@nib/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { bind, HERE, replace } from './bind'
import { meeting } from './join'
import { peersIn, relative } from './peers'
import { RoomSocket } from './socket'

/** How long a caret waits before it is announced. A held arrow key moves it every
 *  few milliseconds and nobody needs to watch that happen; a caret that landed
 *  where somebody clicked is still announced well inside the time it takes to see
 *  it get there. */
const CARET_DELAY = 40

/** Where an update arriving from the room is marked as having come from. */
const ROOM = 'room'

/** What a room is joined on behalf of. */
export interface Joining {
  noteId: string
  token: string
  /** The note as the app holds it, which is what every pane showing it is a view
   *  onto; see shared.ts in the editor package. */
  note: SharedDoc
  /** The words as this device's file holds them, and the account's hash of them as
   *  of the last sync. A null hash is a note the account has never handed over,
   *  which is a note with nothing to compare against. */
  held: { text: string; hash: string | null }
  who: { name: string; accent: string }
  scheme: 'dark' | 'light'
  /** Told how many other devices are in the note, whenever that changes. */
  onPeers: (present: number) => void
  /** The hash of a string. Asked of the app because the platform answers it
   *  asynchronously and a room should not have a second way of doing it. */
  digest: (text: string) => Promise<string>
}

export class Room {
  readonly doc = new Y.Doc()
  readonly text = this.doc.getText(TEXT)
  readonly awareness = new Awareness(this.doc)

  /** Whether the note and the room now hold the same words, and every keystroke
   *  from here goes both ways.
   *
   *  False for the moment between opening a note and the room answering with what
   *  it holds. Until then the room is not the note's truth yet, so the file sync
   *  carries on as it always did; see rooms.svelte.ts. */
  settled = false

  private readonly socket: RoomSocket
  private unbind: (() => void) | null = null
  /** Set once the room has said what it holds, which is when the words this
   *  device brought may be compared with it. */
  private caughtUp = false
  private caret: { anchor: number; head: number } | null = null
  private caretTimer: ReturnType<typeof setTimeout> | null = null
  private scheme: 'dark' | 'light'

  constructor(private readonly joining: Joining) {
    this.scheme = joining.scheme
    this.socket = new RoomSocket(joining.noteId, joining.token, {
      opened: () => this.greet(),
      heard: (message) => void this.hear(message),
      closed: () => this.alone(),
    })

    this.awareness.setLocalStateField('who', joining.who)

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // An update that came out of the room is already in the room.
      if (origin !== ROOM) this.socket.send(syncUpdate(update))
    })

    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange) => {
      const changed = [...added, ...updated, ...removed]
      if (changed.length) this.socket.send(awarenessUpdate(this.awareness, changed))

      this.showPeers()
    })

    this.socket.start()
  }

  /** The scheme changed, so every caret wants the other shade of its colour. */
  repaint(scheme: 'dark' | 'light') {
    if (scheme === this.scheme) return

    this.scheme = scheme
    this.showPeers()
  }

  /** Where this device's caret is, on its way to the others. Coalesced, because a
   *  caret held down moves far more often than anybody can watch. */
  moved(anchor: number, head: number) {
    this.caret = { anchor, head }
    if (this.caretTimer) return

    this.caretTimer = setTimeout(() => {
      this.caretTimer = null
      const at = this.caret
      // Nothing to place a caret against until the room has said what it holds.
      if (!at || !this.caughtUp) return

      this.awareness.setLocalStateField('caret', {
        anchor: relative(this.text, at.anchor),
        head: relative(this.text, at.head),
      })
    }, CARET_DELAY)
  }

  leave() {
    if (this.caretTimer) clearTimeout(this.caretTimer)
    this.caretTimer = null

    this.unbind?.()
    this.unbind = null
    this.socket.stop()
    this.joining.note.announce([setPeers.of([])])
    this.joining.onPeers(0)
    this.awareness.destroy()
    this.doc.destroy()
  }

  /** What this device says the moment the socket is up: what it holds, so the room
   *  can send back what it is missing, and who it is. */
  private greet() {
    this.socket.send(syncStep1(this.doc))

    // A room that was asleep has forgotten who is here, and this device has not:
    // saying it again is what puts the carets back.
    if (this.awareness.getLocalState()) {
      this.socket.send(awarenessUpdate(this.awareness, [this.doc.clientID]))
    }
  }

  /** The connection went. Everybody else's caret goes with it: where they are is
   *  no longer something this device knows. */
  private alone() {
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
    forget(this.awareness, others, 'gone')
  }

  private async hear(message: Uint8Array) {
    const answer = receive(message, this.doc, this.awareness, ROOM)
    if (answer) this.socket.send(answer)

    // The room has finished saying what it holds. Until now the note has been left
    // alone; this is where the two are brought together, once.
    if (!this.caughtUp && isCatchUp(message)) {
      this.caughtUp = true
      await this.together()
    }
  }

  /** The room's words and this device's file, brought together, and the note joined
   *  to the shared text from here on. Which of the two is news is decided next
   *  door, in join.ts. */
  private async together() {
    const { note, held, digest } = this.joining
    const mine = held.text
    const untouched = held.hash !== null && (await digest(mine)) === held.hash
    const met = meeting(mine, this.text.toJSON(), untouched)

    if (met.kind === 'take') note.arrived([met.change])
    else if (met.kind === 'offer') this.doc.transact(() => replace(this.text, met.change), HERE)

    this.unbind = bind(note, this.text)
    this.settled = true
    this.showPeers()

    // The caret was held back until there was a text to place it against.
    const at = this.caret
    if (at) this.moved(at.anchor, at.head)
  }

  /** Who is in the note, told to every pane showing it and counted for the tab. */
  private showPeers() {
    const { present, carets } = peersIn(this.awareness, this.doc, this.scheme)

    this.joining.note.announce([setPeers.of(carets)])
    this.joining.onPeers(present)
  }
}

/** What the awareness protocol reports when its map changes. */
interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}
