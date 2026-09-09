/** One open note, joined to the room the other devices are in.
 *
 *  The document is a Yjs one and the note's words are a `Y.Text` in it. Typing
 *  goes into that text and out over the socket; what comes back goes into the
 *  note. Neither side waits for the other: a keystroke is drawn by the editor that
 *  took it, which is what keeps typing feeling like typing, and the room is where
 *  two versions of the same paragraph are settled.
 *
 *  The socket, the awareness and the greeting are next door in door.ts, which a
 *  canvas's room shares. What is here is the note: its words, its carets, and the
 *  one moment worth reading carefully.
 *
 *  That moment is joining. The document starts empty and is filled by the room,
 *  with the note left alone until that has happened - so what the room holds and
 *  what this device's file holds can be compared rather than one silently landing
 *  on the other. Which of the two is news is decided by a single question: is the
 *  file still exactly what the account last handed this device? If it is,
 *  everything that differs was written elsewhere and the room's words go into the
 *  note. If it is not, this device wrote while it was away, and what it wrote goes
 *  into the room as the edit it was. Neither case loses a word, and neither leaves
 *  a second file to go and find. */

import { setPeers, type SharedDoc } from '@nib/editor'
import { TEXT } from '@nib/rooms'
import { bind, replace } from './bind'
import { HERE, RoomDoor, type Who } from './door'
import { meeting } from './join'
import { peersIn, relative } from './peers'

/** What a room is joined on behalf of. */
export interface Joining {
  noteId: string
  token: string
  /** The note as the app holds it, which is what every pane showing it is a view
   *  onto; see shared.ts in the editor package. The words are read from here when
   *  the room answers rather than kept as a copy from when it was joined: joining
   *  is a round trip, and whatever was typed during it is part of what this device
   *  holds. */
  note: SharedDoc
  /** The account's hash of this file as of the last sync. Null for a note the
   *  account has never handed over, which is a note with nothing to compare
   *  against. */
  hash: string | null
  who: Who
  scheme: 'dark' | 'light'
  /** Told how many other devices are in the note, whenever that changes. */
  onPeers: (present: number) => void
  /** The hash of a string. Asked of the app because the platform answers it
   *  asynchronously and a room should not have a second way of doing it. */
  digest: (text: string) => Promise<string>
  /** Whether the document above is still on the file this room was joined for.
   *
   *  A document outlives the file in it: the one tab that previews a note takes
   *  another note on in the same document rather than being swapped for another,
   *  and which document belongs in which room is worked out in an effect - which
   *  cannot run inside the click that moved it. So for that beat the room is still
   *  joined to words that are now another note's, and this is what says so.
   *
   *  Everything a room does to the words asks this first. Without it, a single
   *  click from one note to the next offers the second note's words to the first
   *  note's room, which settles them into the account, which is one note
   *  overwritten by another. See rooms.svelte.ts, which answers it. */
  holds: () => boolean
}

export class Room {
  private readonly door: RoomDoor
  private unbind: (() => void) | null = null
  private scheme: 'dark' | 'light'
  /** Whether this room has been left. A greeting is a round trip and the answer to
   *  it lands whenever it lands, which can be after the last tab holding the note
   *  closed or after the document moved on; what it was about to do must not happen
   *  behind the room's back. */
  private left = false

  constructor(private readonly joining: Joining) {
    this.scheme = joining.scheme
    this.door = new RoomDoor({
      noteId: joining.noteId,
      token: joining.token,
      who: joining.who,
      caughtUp: () => this.together(),
      present: () => this.showPeers(),
    })
  }

  /** Whether the note and the room now hold the same words, and every keystroke
   *  from here goes both ways.
   *
   *  False for the moment between opening a note and the room answering with what
   *  it holds. Until then the room is not the note's truth yet, so the file sync
   *  carries on as it always did; see rooms.svelte.ts. */
  get settled(): boolean {
    return this.door.caughtUp
  }

  private get text() {
    return this.door.doc.getText(TEXT)
  }

  /** Whoever is at this device is called something else now. Next door, because
   *  a canvas's room says it the same way; see door.ts. */
  rename(person: string | undefined) {
    this.door.rename(person)
  }

  /** The scheme changed, so every caret wants the other shade of its colour. */
  repaint(scheme: 'dark' | 'light') {
    if (scheme === this.scheme) return

    this.scheme = scheme
    this.showPeers()
  }

  /** Where this device's caret is, on its way to the others. The position is worked
   *  out when the message goes rather than now, because the words underneath may
   *  have moved in between - and because until the room has answered there is no
   *  text to place a caret against at all. */
  moved(anchor: number, head: number) {
    this.door.announce('caret', () => ({
      anchor: relative(this.text, anchor),
      head: relative(this.text, head),
    }))
  }

  leave() {
    this.left = true
    this.unbind?.()
    this.unbind = null
    this.door.leave()
    this.joining.note.announce([setPeers.of([])])
    this.joining.onPeers(0)
  }

  /** Whether this room is still about the words it was joined to: it has not been
   *  left, and the document is still on the file it was joined for. Asked before
   *  anything at all is done to the words; see `Joining.holds`. */
  private holds(): boolean {
    return !this.left && this.joining.holds()
  }

  /** The room's words and this device's file, brought together, and the note joined
   *  to the shared text from here on. Which of the two is news is decided next
   *  door, in join.ts. */
  private async together() {
    const { note, hash, digest } = this.joining
    const asked = note.text.toString()
    const untouched = hash !== null && (await digest(asked)) === hash

    // The hash is answered asynchronously, and a click can land inside that
    // moment: the tab moves on to another note and this room is about a file these
    // words are no longer. Neither text is anybody's news then, and binding would
    // leave the note writing into a room it has left.
    if (!this.holds()) return

    // Both texts are read after the hash rather than before it. The hash is
    // answered asynchronously, and in that moment a keystroke may land here and
    // an update may arrive from the room; a change worked out against either text
    // as it was would then be applied to the other as it is. A note that moved
    // while the hash was being worked out is this device writing, whatever the
    // hash came back saying.
    const mine = note.text.toString()
    const met = meeting(mine, this.text.toJSON(), untouched && mine === asked)

    if (met.kind === 'take') note.arrived([met.change])
    else if (met.kind === 'offer') {
      this.door.doc.transact(() => replace(this.text, met.change), HERE)
    }

    this.unbind = bind(note, this.text, () => this.holds())
  }

  /** Who is in the note, told to every pane showing it and counted for the tab. */
  private showPeers() {
    const { present, carets } = peersIn(this.door.awareness, this.door.doc, this.scheme)

    this.joining.note.announce([setPeers.of(carets)])
    this.joining.onPeers(present)
  }
}
