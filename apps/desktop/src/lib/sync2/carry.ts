import type { Awareness } from 'y-protocols/awareness'
import { account } from '../account.svelte'
import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { rooms } from '../rooms.svelte'
import type { Carrying } from '../rooms/carried'
import type { Who } from '../rooms/door'
import type { Seen } from '../rooms/peers'
import { deviceAccent, deviceName, personFace, personName } from '../rooms/who'
import { theme } from '../theme.svelte'
import type { NoteDoc } from '../workspace/documents.svelte'
import type { InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface } from '../canvas/shared'

export interface Carry {
  noteId: string
  on: { note: NoteDoc } | { surface: PlaneSurface } | { relay: true }
  carrying: Carrying
  gone: () => void
  holds?: () => boolean
}

export async function carry(
  key: string,
  carried: Carry,
): Promise<{
  hand?: (at: Point | null, drawing: InkStroke | null) => void
  awareness?: Awareness
} | null> {
  const token = account.token
  if (!token || rooms.carried.has(key)) return null
  const { CarriedRoom, CarriedPlaneRoom } = await import('../rooms/carried')
  if (rooms.carried.has(key) || account.token !== token) return null

  const entering = {
    noteId: carried.noteId,
    token,
    who: whoHere(),
    scheme: theme.current,
    onPeers: (count: number, seen?: Seen) => {
      rooms.heard(key, count, seen)
    },
    gone: () => {
      uncarry(key)
      carried.gone()
    },
    refused: () => {
      uncarry(key)
      busy.failed(t('This note is as large as a note in a room may get.'))
    },
    shut: (signedOut: boolean) => {
      uncarry(key)
      if (signedOut) void account.recheck()
    },
    demoted: () => {
      const note = 'note' in carried.on ? carried.on.note : null
      if (note) note.reads = true
      uncarry(key)
      void account
        .loadSpaces()
        .then(
          () => {
            if (note) note.reads = false
          },
          () => undefined,
        )
        .then(() => {
          carried.gone()
        })
    },
    holds: carried.holds ?? (() => true),
    carrying: carried.carrying,
  }
  if ('surface' in carried.on) {
    const room = new CarriedPlaneRoom({ ...entering, surface: carried.on.surface })
    rooms.carried.set(key, { live: carried.on.surface, room })
    return { hand: room.hand.bind(room), awareness: room.awareness }
  }
  const live = 'note' in carried.on ? carried.on.note.live : NOBODY
  const room = new CarriedRoom({ ...entering, note: live })
  rooms.carried.set(key, { live, room, shown: () => room.shown() })
  return { awareness: room.awareness }
}

const NOBODY = { announce: () => undefined }

export function whoHere(): Who {
  return {
    name: deviceName(t('Browser')),
    accent: deviceAccent(),
    person: personName(),
    ...personFace(),
  }
}

export function uncarry(key: string): void {
  const carried = rooms.carried.get(key)
  if (!carried) return
  carried.room.leave()
  rooms.carried.delete(key)
  rooms.heard(key, 0)
}
