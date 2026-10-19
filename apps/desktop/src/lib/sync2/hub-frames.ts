/** What this device and its account's hub say to each other: JSON text frames, one
 *  message a frame, and `beat` beside them, which the service answers `ok` without
 *  waking anybody. The hub's own half is services/sync/src/hub/frames.ts; these are the
 *  same shapes, read from the other side, and docs/sync-v2.md section 7 is both.
 *
 *  Read here and nowhere else. A frame from the hub is unknown until `readHubFrame` has
 *  looked at it, and one this version cannot read is dropped rather than half
 *  understood, the way the hub drops one of ours. Pure, so the reading is tested
 *  without a socket. */

import { isRecord } from '../stored'

/** The heartbeat and its answer, as the runtime on the other end answers it. */
export const BEAT = 'beat'
export const BEAT_ANSWER = 'ok'

/** A device's id, as the hub takes one. */
export const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

/** What this device says. */
export type FromDevice =
  | { t: 'hello'; device: string; name: string; platform: string; app: string }
  | { t: 'active' }
  | { t: 'idle' }

/** What the hub says. */
export type FromHub =
  | { t: 'poke'; space: string; seq: number }
  /** A session on the account's online machine was made or ended, or its shell ended:
   *  Settings' list of them asks again (docs/online-terminal.md 4.10). */
  | { t: 'terms' }
  /** The account's AI accounts moved on another device: read them again
   *  (ai/vault/vault.svelte.ts). */
  | { t: 'ai' }
  /** A chat moved on (`ChatPoke` in @nib/chats/wire): handed on unread, because the
   *  chats read it with their own check, fetched with them after the launch. */
  | { t: 'chat'; said: Record<string, unknown> }

export type HubType = FromHub['t']

/** One kind of frame, by its `t`. */
export type HubFrame<T extends HubType> = Extract<FromHub, { t: T }>

const text = (value: unknown): value is string => typeof value === 'string'
const whole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** A frame from the hub, or null for anything that is not one. */
export function readHubFrame(said: string): FromHub | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(said)
  } catch {
    // `ok` answering a beat, or something this version does not speak.
    return null
  }
  if (!isRecord(parsed)) return null

  const one = parsed
  switch (one.t) {
    case 'poke':
      return text(one.space) && whole(one.seq)
        ? { t: 'poke', space: one.space, seq: one.seq }
        : null

    case 'terms':
      return { t: 'terms' }

    case 'ai':
      return { t: 'ai' }

    case 'chat':
      return { t: 'chat', said: one }

    default:
      return null
  }
}
