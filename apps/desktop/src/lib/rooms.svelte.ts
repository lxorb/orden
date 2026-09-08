/** Which files are being worked in together, and by how many devices.
 *
 *  A file joins its room when it is open, signed in, and the account holds a copy
 *  of it for the room to be about; it leaves when the last tab holding it closes.
 *  Nothing asks for any of that: the list of what is open is one the app already
 *  keeps, and this follows it. One room per file however many panes show it,
 *  because a note in two panes is one note - the same reason there is one document.
 *
 *  Notes and canvases both. A note's room holds its words as one text; a canvas's
 *  holds the objects on the plane, one entry each, so two people drawing keep both
 *  drawings whole. A canvas also has to wait for its surface: a plane is what the
 *  room is about, and a plane exists once a tab is showing one, so whichever of the
 *  two arrives second joins them.
 *
 *  What joining one room means is next door, in rooms/room.ts and rooms/plane.ts. */

import { type EditorView, sharedOf } from '@nib/editor'
import { account } from './account.svelte'
import type { PlaneSurface } from './canvas/shared'
import { without } from './records'
import { PlaneRoom } from './rooms/plane'
import { Room } from './rooms/room'
import { deviceAccent, deviceName, personName } from './rooms/who'
import { t } from './i18n.svelte'
import { type Scheme, theme } from './theme.svelte'
import type { NoteDoc } from './workspace/documents.svelte'

/** A file the app has open and the account has a copy of. What this store is
 *  handed; it holds nothing about tabs or panes. */
interface Open {
  /** Which document this is within this run of the app; see NoteDoc.key. */
  key: string
  /** The file's id on the account, which is what names its room. */
  noteId: string
  note: NoteDoc
  /** The account's hash of this file as of the last sync, or null for one it has
   *  never handed over. */
  hash: string | null
}

/** One file in a room: the room, and which file the room is about - so a document
 *  that has moved on to another file is noticed and rejoined. */
interface Joined {
  room: Room | PlaneRoom
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
  /** How many other devices are in each open file, by document key. Where the tab
   *  gets its dots. */
  present = $state<Record<string, number>>({})

  private readonly held = new Map<string, Joined>()
  /** The canvas surfaces on screen, by document key; see `drawing`. */
  private readonly planes = new Map<string, PlaneSurface>()
  /** What was last followed, so a surface arriving after its file can be joined
   *  without the app being asked what is open all over again. */
  private open: readonly Open[] = []

  /** The files a room now holds the truth of, by their id on the account. What the
   *  file sync asks, so it can leave those files to the room; see sync/mirror.ts.
   *
   *  A room that has been opened but has not yet said what it holds is not in this
   *  list. Until that moment nothing has been settled and the file is still the
   *  best answer anybody has, so a pass carries on exactly as it did before. */
  get joined(): Set<string> {
    return new Set(
      [...this.held.values()].filter((one) => one.room.settled).map((one) => one.noteId),
    )
  }

  /** The open files, as the app now has them. Rooms are joined and left to match:
   *  nothing here is called for a particular file, so no call site can forget one.
   *
   *  Called on every change to what is open, which is rare, and does nothing at all
   *  when the list says what it said the last time. */
  follow(open: readonly Open[]) {
    this.open = open
    const token = account.token
    const wanted = new Map(token ? open.map((one) => [one.key, one]) : [])

    for (const [key, joined] of this.held) {
      // Still open, and still the same file: leave it alone. A preview tab that has
      // moved on is another note in the same document, and wants another room.
      const still = wanted.get(key)
      if (still?.noteId === joined.noteId && this.ready(still)) continue

      joined.room.leave()
      this.held.delete(key)
      this.present = without(this.present, key)
    }

    if (!token) return

    for (const [key, one] of wanted) {
      if (!this.held.has(key) && this.ready(one)) this.join(key, one, token)
    }
  }

  /** A canvas surface arriving, or going.
   *
   *  A note's room is about a text the app holds either way, but a canvas's room is
   *  about the plane a tab is showing, and the tab and the account's list of files
   *  arrive at their own moments. So the surface says when it is there and the rooms
   *  are worked out again, which means neither side has to be second. */
  drawing(key: string, surface: PlaneSurface | null) {
    if (surface) this.planes.set(key, surface)
    else this.planes.delete(key)

    this.follow(this.open)
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
      if (joined.note.live !== shared || !(joined.room instanceof Room)) continue

      const at = view.state.selection.main
      joined.room.moved(at.anchor, at.head)
    }
  }

  /** A caret's colour depends on the scheme, so a theme change reaches every
   *  room. */
  repaint(scheme: Scheme) {
    for (const joined of this.held.values()) joined.room.repaint(scheme)
  }

  /** And so does the name over it, which can change while a file is open: a guest
   *  a link let in renaming themselves, or an account choosing a name. */
  rename(person: string | undefined) {
    for (const joined of this.held.values()) joined.room.rename(person)
  }

  /** Whether there is anything for a room to be about yet. Always, for a note; for
   *  a canvas, once the surface has said it is there. */
  private ready(open: Open): boolean {
    return open.note.kind !== 'canvas' || this.planes.has(open.key)
  }

  private join(key: string, open: Open, token: string) {
    const onPeers = (count: number) => {
      this.present = count ? { ...this.present, [key]: count } : without(this.present, key)
    }

    // Both names, because a caret and a pointer answer a different question
    // depending on who else is there; which one is drawn is decided by whoever is
    // looking. See rooms/peers.ts.
    const who = { name: deviceName(t('Browser')), accent: deviceAccent(), person: personName() }
    const shape = { noteId: open.noteId, token, who, scheme: theme.current, onPeers }

    const surface = this.planes.get(key)
    if (open.note.kind === 'canvas' && surface) {
      this.held.set(key, {
        room: new PlaneRoom({ ...shape, surface }),
        noteId: open.noteId,
        note: open.note,
      })
      return
    }

    // The words themselves are not handed over: the room reads them from the
    // document when it has something to compare them with, which is a round trip
    // later and may be several keystrokes later. See rooms/room.ts.
    const room = new Room({
      ...shape,
      note: open.note.live,
      hash: open.hash,
      digest: sha256,
    })

    this.held.set(key, { room, noteId: open.noteId, note: open.note })
  }
}

export const rooms = new Rooms()
