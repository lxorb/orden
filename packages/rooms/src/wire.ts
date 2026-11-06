import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { Awareness } from 'y-protocols/awareness'
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import type * as Y from 'yjs'

export const TEXT = 'note'

const SYNC = 0
const AWARENESS = 1

const STEP1 = 0
const STEP2 = 1
const UPDATE = 2

const TOKEN = 'nib.token.'

export function subprotocol(token: string): string {
  return `${TOKEN}${token}`
}

export function tokenOf(header: string | undefined): string | null {
  const offered = (header ?? '').split(',').map((one) => one.trim())
  const carrying = offered.find((one) => one.startsWith(TOKEN))

  return carrying ? carrying.slice(TOKEN.length) : null
}

function framed(kind: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, kind)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

export function syncStep1(doc: Y.Doc): Uint8Array {
  return framed(SYNC, (encoder) => writeSyncStep1(encoder, doc))
}

export function syncStep1Of(sv: Uint8Array): Uint8Array {
  return framed(SYNC, (encoder) => {
    encoding.writeVarUint(encoder, STEP1)
    encoding.writeVarUint8Array(encoder, sv)
  })
}

export function syncStep2Of(update: Uint8Array): Uint8Array {
  return framed(SYNC, (encoder) => {
    encoding.writeVarUint(encoder, STEP2)
    encoding.writeVarUint8Array(encoder, update)
  })
}

export type SyncMessage =
  | { kind: 'step1'; sv: Uint8Array }
  | { kind: 'step2'; update: Uint8Array }
  | { kind: 'update'; update: Uint8Array }

export function readSync(message: Uint8Array): SyncMessage | null {
  try {
    const decoder = decoding.createDecoder(message)
    if (decoding.readVarUint(decoder) !== SYNC) return null
    const kind = decoding.readVarUint(decoder)
    const bytes = decoding.readVarUint8Array(decoder)
    if (kind === STEP1) return { kind: 'step1', sv: bytes }
    if (kind === STEP2) return { kind: 'step2', update: bytes }
    if (kind === UPDATE) return { kind: 'update', update: bytes }
    return null
  } catch {
    return null
  }
}

export function syncUpdate(update: Uint8Array): Uint8Array {
  return framed(SYNC, (encoder) => writeUpdate(encoder, update))
}

export function awarenessUpdate(awareness: Awareness, clients: readonly number[]): Uint8Array {
  return framed(AWARENESS, (encoder) =>
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [...clients])),
  )
}

export function awarenessState(awareness: Awareness): Uint8Array | null {
  const clients = [...awareness.getStates().keys()]
  return clients.length ? awarenessUpdate(awareness, clients) : null
}

export function receive(
  message: Uint8Array,
  doc: Y.Doc,
  awareness: Awareness,
  origin: unknown,
  mayAnnounce?: (client: number) => boolean,
): Uint8Array | null {
  try {
    return applied(message, doc, awareness, origin, mayAnnounce)
  } catch {
    return null
  }
}

function applied(
  message: Uint8Array,
  doc: Y.Doc,
  awareness: Awareness,
  origin: unknown,
  mayAnnounce?: (client: number) => boolean,
): Uint8Array | null {
  const decoder = decoding.createDecoder(message)
  const kind = decoding.readVarUint(decoder)

  if (kind === AWARENESS) {
    const update = decoding.readVarUint8Array(decoder)
    applyAwarenessUpdate(awareness, mayAnnounce ? only(update, mayAnnounce) : update, origin)
    return null
  }

  if (kind !== SYNC) return null

  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, SYNC)
  readSyncMessage(decoder, encoder, doc, origin)

  return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null
}

function only(update: Uint8Array, kept: (client: number) => boolean): Uint8Array {
  const decoder = decoding.createDecoder(update)
  const entries: (readonly [number, number, string])[] = []
  for (let left = decoding.readVarUint(decoder); left > 0; left--) {
    const entry = [
      decoding.readVarUint(decoder),
      decoding.readVarUint(decoder),
      decoding.readVarString(decoder),
    ] as const
    if (kept(entry[0])) entries.push(entry)
  }

  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, entries.length)
  for (const [client, clock, state] of entries) {
    encoding.writeVarUint(encoder, client)
    encoding.writeVarUint(encoder, clock)
    encoding.writeVarString(encoder, state)
  }
  return encoding.toUint8Array(encoder)
}

export function isCatchUp(message: Uint8Array): boolean {
  try {
    const decoder = decoding.createDecoder(message)
    return decoding.readVarUint(decoder) === SYNC && decoding.readVarUint(decoder) === STEP2
  } catch {
    return false
  }
}

export function isEdit(message: Uint8Array): boolean {
  try {
    const decoder = decoding.createDecoder(message)
    if (decoding.readVarUint(decoder) !== SYNC) return false

    const kind = decoding.readVarUint(decoder)
    return kind === STEP2 || kind === UPDATE
  } catch {
    return true
  }
}

export function forget(awareness: Awareness, clients: readonly number[], origin: unknown) {
  if (clients.length) removeAwarenessStates(awareness, [...clients], origin)

  for (const client of clients) awareness.meta.delete(client)
}

export function unattended(awareness: Awareness) {
  awareness.setLocalState(null)

  const timer: unknown = awareness._checkInterval
  if (typeof timer === 'number') clearInterval(timer)
}
