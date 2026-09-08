/** Which notes are being written in together, and by how many devices.
 *
 *  A note joins its room when it is open, signed in, and the account holds a copy
 *  of it for the room to be about; it leaves when the last tab holding it closes.
 *  Nothing asks for any of that: the list of open notes is one the app already
 *  keeps, and this follows it. One room per note however many panes show it,
 *  because a note in two panes is one note - the same reason there is one
 *  document.
 *
 *  Rooms are for notes. A canvas has its own way of being settled, in which every
 *  card and every stroke has an id and a time of its own, and merging two drawings
 *  as if they were prose would make neither; see packages/markdown/canvas-merge.ts.
 *
 *  What joining one note's room means is next door, in rooms/room.ts. */

import { type EditorView, sharedOf } from '@nib/editor'
import { account } from './account.svelte'
import { without } from './records'
import { Room } from './rooms/room'
import { deviceAccent, deviceName, personName } from './rooms/who'
import { t } from './i18n.svelte'
import { type Scheme, theme } from './theme.svelte'
import type { NoteDoc } from './workspace/documents.svelte'

/** A note the app has open and the account has a copy of. What this store is
 *  handed; it holds nothing about tabs or panes. */
interface Open {
  /** Which document this is within this run of the app; see NoteDoc.key. */
  key: string
  /** The note's id on the account, which is what names its room. */
  noteId: string
  note: NoteDoc
  /** The account's hash of this note as of the last sync, or null for one it has
   *  never handed over. */
  hash: string | null
}

/** One note in a room: the room, the note, and which note the room is about - so
 *  a document that has moved on to another note is noticed and rejoined. */
interface Joined {
  room: Room
  noteId: string
  note: NoteDoc
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

class Rooms {
  /** How many other devices are in each open note, by document key. Where the tab
   *  gets its dots. */
  present = $state<Record<string, number>>({})

  private readonly held = new Map<string, Joined>()

  /** The notes a room now holds the truth of, by their id on the account. What the
   *  file sync asks, so it can leave those notes to the room; see sync/mirror.ts.
   *
   *  A room that has been opened but has not yet said what it holds is not in this
   *  list. Until that moment nothing has been settled and the file is still the
   *  best answer anybody has, so a pass carries on exactly as it did before. */
  get joined(): Set<string> {
    return new Set(
      [...this.held.values()].filter((one) => one.room.settled).map((one) => one.noteId),
    )
  }

  /** The open notes, as the app now has them. Rooms are joined and left to match:
   *  nothing here is called for a particular note, so no call site can forget one.
   *
   *  Called on every change to what is open, which is rare, and does nothing at
   *  all when the list says what it said the last time. */
  follow(open: readonly Open[]) {
    const token = account.token
    const wanted = new Map(token ? open.map((one) => [one.key, one]) : [])

    for (const [key, joined] of this.held) {
      // Still open, and still the same note: leave it alone. A preview tab that
      // has moved on is another note in the same document, and wants another room.
      if (wanted.get(key)?.noteId === joined.noteId) continue

      joined.room.leave()
      this.held.delete(key)
      this.present = without(this.present, key)
    }

    if (!token) return

    for (const [key, one] of wanted) {
      if (!this.held.has(key)) this.join(key, one, token)
    }
  }

  /** Everything goes: signing out, or the app closing. */
  clear() {
    this.follow([])
  }

  /** A pane reporting that its caret moved, on its way to the other devices. Which
   *  document the view is showing says which room to tell; see shared.ts in the
   *  editor package. */
  moved(view: EditorView) {
    const shared = sharedOf(view.state)
    if (!shared) return

    for (const joined of this.held.values()) {
      if (joined.note.live !== shared) continue

      const at = view.state.selection.main
      joined.room.moved(at.anchor, at.head)
    }
  }

  /** A caret's colour depends on the scheme, so a theme change reaches every
   *  room. */
  repaint(scheme: Scheme) {
    for (const joined of this.held.values()) joined.room.repaint(scheme)
  }

  private join(key: string, open: Open, token: string) {
    // The room compares what this device holds with what the room holds, and what
    // this device holds is the keystrokes since the last pause as well.
    open.note.flush()

    const room = new Room({
      noteId: open.noteId,
      token,
      note: open.note.live,
      held: { text: open.note.text, hash: open.hash },
      // Both, because a caret answers a different question depending on who
      // else is in the note; which one it draws is decided by whoever is
      // looking. See rooms/peers.ts.
      who: { name: deviceName(t('Browser')), accent: deviceAccent(), person: personName() },
      scheme: theme.current,
      onPeers: (count) => {
        this.present = count ? { ...this.present, [key]: count } : without(this.present, key)
      },
      digest: sha256,
    })

    this.held.set(key, { room, noteId: open.noteId, note: open.note })
  }
}

export const rooms = new Rooms()
