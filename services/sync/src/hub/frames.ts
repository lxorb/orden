/** What a device and its hub say to each other: JSON text frames, one message a
 *  frame, and `beat` beside them, which the runtime answers without waking anybody.
 *
 *  Read here and nowhere else. Everything a device sends is unknown until it has
 *  been through `readFrame`, which answers a typed message or nothing: a frame this
 *  version cannot read is dropped rather than half understood, and none of them
 *  carries a time, because every time the hub decides by is its own. See
 *  docs/sync-v2.md section 7. */

import type { ChatPoke } from '@nib/chats/wire'

/** A device's id, made by the device and kept in its sync store. */
export const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

/** How long a frame may be: far past the longest a correct device sends, a `hello`. */
const MOST_FRAME = 4096

/** The longest name, platform and version a `hello` keeps. */
const MOST_NAME = 120
const MOST_PLATFORM = 24
const MOST_APP = 32

/** Until #393 a device also asked for web-login leases and the web key here
 *  (docs/sync-v2.md section 6). Those frames are read as nothing now, and dropped. */
export type FromDevice =
  | { t: 'hello'; device: string; name: string; platform: string; app: string }
  | { t: 'active' }
  | { t: 'idle' }

export type FromHub =
  | { t: 'poke'; space: string; seq: number }
  /** The account's online terminal machine changed state, to every device of its
   *  owner at once, so a status dot changes everywhere (docs/online-terminal.md, 4.6). */
  | { t: 'machine'; state: 'asleep' | 'starting' | 'awake' | 'stopping' }
  /** A session on the account's machine was made or ended, or its shell ended: Settings'
   *  list asks again (docs/online-terminal.md 4.10). Says nothing of which. */
  | { t: 'terms' }
  /** The account's AI accounts moved (ai/vault.ts): read them again. Says nothing else. */
  | { t: 'ai' }
  /** A chat this account reaches moved while none of its devices had it open
   *  (docs/chats.md 4.4): `ChatPoke`, which never carries words. */
  | ChatPoke

type Fields = Record<string, unknown>

const text = (fields: Fields, name: string, most: number): string | null => {
  const value = fields[name]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= most ? trimmed : null
}

const matching = (fields: Fields, name: string, shape: RegExp): string | null => {
  const value = fields[name]
  return typeof value === 'string' && shape.test(value) ? value : null
}

/** A message from a device, or null for anything that is not one. */
export function readFrame(said: string): FromDevice | null {
  if (said.length > MOST_FRAME) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(said)
  } catch {
    // Not JSON, so not a message: `beat` never reaches here, and nothing else a
    // correct device sends is anything but an object.
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const fields = parsed as Fields
  switch (fields.t) {
    case 'active':
    case 'idle':
      return { t: fields.t }

    case 'hello': {
      const device = matching(fields, 'device', DEVICE)
      const name = text(fields, 'name', MOST_NAME)
      const platform = text(fields, 'platform', MOST_PLATFORM)
      const app = text(fields, 'app', MOST_APP)
      if (!device || !name || !platform || !app) return null
      // A device from before #393 says its public key here too, for the web key. It is
      // not read.
      return { t: 'hello', device, name, platform, app }
    }

    default:
      return null
  }
}

/** The one thing every socket write goes through. A socket the runtime has
 *  already given up on throws on `send`, and its close handler is what deals with
 *  that; nothing a hub says to one device is worth failing the others over. */
export function say(socket: WebSocket, frame: FromHub): void {
  try {
    socket.send(JSON.stringify(frame))
  } catch {
    // Closing or closed: see above.
  }
}
