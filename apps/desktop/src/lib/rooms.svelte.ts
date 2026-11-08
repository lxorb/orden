import { documentOf, type EditorView } from '@orden/editor'
import { account } from './account.svelte'
import type { PlaneSurface } from './canvas/shared'
import { busy } from './busy.svelte'
import { sha256 } from './bytes'
import { without } from './records'
import { roomKindOf } from './rooms/kind'
import type { Seen } from './rooms/peers'
import type { PlaneRoom } from './rooms/plane'
import type { Room } from './rooms/room'
import { deviceAccent, deviceName, personFace, personName } from './rooms/who'
import { t } from './i18n.svelte'
import { type Scheme, theme } from './theme.svelte'
import type { NoteDoc } from './workspace/documents.svelte'

interface Open {
  key: string
  noteId: string
  note: NoteDoc
  hash: string | null
  version: number
}

export function inRooms(
  open: readonly { key: string; path: string; note: NoteDoc }[],
  tracked: ((path: string) => { id: string; version: number; hash: string | null } | null) | null,
): Open[] {
  return open.flatMap(({ key, path, note }) => {
    const held = note.shared ? { id: note.shared, version: 0, hash: null } : tracked?.(path)
    return held ? [{ key, note, noteId: held.id, hash: held.hash, version: held.version }] : []
  })
}

type Joined = {
  noteId: string
  token: string
  note: NoteDoc
  hash: string | null
} & ({ kind: 'words'; room: Room } | { kind: 'plane'; room: PlaneRoom })

interface Engine {
  Room: typeof import('./rooms/room').Room
  PlaneRoom: typeof import('./rooms/plane').PlaneRoom
}

class Rooms {
  present = $state<Record<string, number>>({})
  seen = $state<Record<string, Seen>>({})
  surfaces = $state.raw<ReadonlyMap<string, PlaneSurface>>(new Map())

  heard(key: string, count: number, seen?: Seen) {
    this.present = count ? { ...this.present, [key]: count } : without(this.present, key)
    this.seen = count && seen ? { ...this.seen, [key]: seen } : without(this.seen, key)
  }

  private engine: Engine | null = null
  private reaching: Promise<void> | null = null

  private readonly held = new Map<string, Joined>()
  private readonly shut = new Map<string, { noteId: string; token: string }>()
  readonly planes = new Map<string, PlaneSurface>()
  drawn: (() => void) | null = null
  private open: readonly Open[] = []

  readonly carried = new Map<
    string,
    { live: unknown; room: Pick<Room, 'moved' | 'repaint' | 'rename' | 'leave'> }
  >()

  carries(noteId: string): boolean {
    for (const one of this.held.values()) {
      if (one.noteId === noteId && one.room.settled) return true
    }

    return false
  }

  letGoUnreached(noteId: string): void {
    let left = false
    for (const [key, joined] of this.held) {
      if (joined.noteId !== noteId || joined.kind !== 'words') continue
      if (!joined.room.bound || joined.room.settled) continue
      joined.room.leave()
      this.held.delete(key)
      this.heard(key, 0)
      left = true
    }
    if (left) this.follow(this.open)
  }

  follow(open: readonly Open[]) {
    this.open = open
    const token = account.token
    const wanted = new Map(token ? open.map((one) => [one.key, one]) : [])

    for (const [key, out] of this.shut) {
      if (wanted.get(key)?.noteId !== out.noteId || out.token !== token) this.shut.delete(key)
    }

    for (const [key, joined] of this.held) {
      const still = wanted.get(key)
      if (
        still?.noteId === joined.noteId &&
        joined.token === token &&
        roomKindOf(still.note) === joined.kind &&
        this.ready(still) &&
        !this.answered(joined, still)
      ) {
        continue
      }

      joined.room.leave()
      this.held.delete(key)
      this.heard(key, 0)
    }

    if (!token) return

    if (!this.engine) {
      void this.reach()
      return
    }

    for (const [key, one] of wanted) {
      if (!this.held.has(key) && !this.shut.has(key) && this.ready(one)) this.join(key, one, token)
    }
  }

  reach(): Promise<void> {
    return (this.reaching ??= Promise.all([import('./rooms/room'), import('./rooms/plane')]).then(
      ([words, planes]) => {
        this.engine = { Room: words.Room, PlaneRoom: planes.PlaneRoom }
        this.follow(this.open)
      },
    ))
  }

  drawing(key: string, surface: PlaneSurface | null) {
    if (surface) this.planes.set(key, surface)
    else this.planes.delete(key)
    this.surfaces = new Map(this.planes)
    this.drawn?.()

    this.follow(this.open)
  }

  clear() {
    this.follow([])
    for (const one of this.carried.values()) one.room.leave()
    this.carried.clear()
  }

  moved(view: EditorView) {
    const shared = documentOf(view)
    if (!shared) return

    for (const joined of this.held.values()) {
      if (joined.note.live !== shared || joined.kind !== 'words') continue

      const at = view.state.selection.main
      joined.room.moved(at.anchor, at.head)
    }
    for (const one of this.carried.values()) {
      const at = view.state.selection.main
      if (one.live === shared) one.room.moved(at.anchor, at.head)
    }
  }

  repaint(scheme: Scheme) {
    for (const joined of this.held.values()) joined.room.repaint(scheme)
    for (const one of this.carried.values()) one.room.repaint(scheme)
  }

  rename(person: string | undefined) {
    for (const joined of this.held.values()) joined.room.rename(person)
    for (const one of this.carried.values()) one.room.rename(person)
  }

  private ready(open: Open): boolean {
    return roomKindOf(open.note) === 'words' || this.planes.has(open.key)
  }

  private answered(joined: Joined, still: Open): boolean {
    return joined.kind === 'words' && joined.room.waiting && still.hash !== joined.hash
  }

  private rebuild(key: string) {
    if (!this.letGo(key)) return
    this.follow(this.open)
  }

  private letGo(key: string): boolean {
    const joined = this.held.get(key)
    if (!joined) return false

    joined.room.leave()
    this.held.delete(key)
    this.heard(key, 0)
    return true
  }

  private join(key: string, open: Open, token: string) {
    const engine = this.engine
    if (!engine) return

    const onPeers = (count: number, seen?: Seen) => {
      this.heard(key, count, seen)
    }

    const who = {
      name: deviceName(t('Browser')),
      accent: deviceAccent(),
      person: personName(),
      ...personFace(),
    }
    const gone = () => this.rebuild(key)

    const refused = () => {
      this.letGo(key)
      this.shut.set(key, { noteId: open.noteId, token })
      busy.failed(t('This note is as large as a note in a room may get.'))
    }

    const shut = (signedOut: boolean) => {
      this.letGo(key)
      this.shut.set(key, { noteId: open.noteId, token })
      if (signedOut) void account.recheck()
    }

    const demoted = () => {
      this.letGo(key)
      void account
        .loadSpaces()
        .catch(() => undefined)
        .then(() => {
          this.follow(this.open)
        })
    }

    const arrivals = open.note.arrivals
    const holds = () => open.note.arrivals === arrivals

    const shape = {
      noteId: open.noteId,
      token,
      who,
      scheme: theme.current,
      onPeers,
      gone,
      refused,
      shut,
      demoted,
      holds,
    }

    const kind = roomKindOf(open.note)
    const surface = this.planes.get(key)
    if (kind === 'plane' && surface) {
      this.held.set(key, {
        room: new engine.PlaneRoom({ ...shape, surface }),
        noteId: open.noteId,
        token,
        note: open.note,
        hash: open.hash,
        kind,
      })
      return
    }

    const room = new engine.Room({
      ...shape,
      note: open.note.live,
      hash: open.hash,
      digest: sha256,
      apart: async (theirs) => {
        const [{ apart }, { modes }] = await Promise.all([
          import('./rooms/apart'),
          import('./modes.svelte'),
        ])

        return await apart(
          modes.conflicts,
          { path: open.note.path ?? '', id: open.noteId, version: open.version },
          theirs,
        )
      },
    })

    this.held.set(key, {
      room,
      noteId: open.noteId,
      token,
      note: open.note,
      hash: open.hash,
      kind: 'words',
    })
  }
}

export const rooms = new Rooms()
