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

/** A lease key or a chunk name: an HMAC this device made, which the service never
 *  reads. The hub's own rule for them. */
const OPAQUE = /^[A-Za-z0-9_-]{16,128}$/

/** A device's id, as the hub takes one. */
export const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

/** What this device says. `release` and `flushed` may carry the version last uploaded,
 *  which the hub does not read; it counts versions itself. */
export type FromDevice =
  | { t: 'hello'; device: string; name: string; platform: string; app: string; pub?: string }
  | { t: 'active' }
  | { t: 'idle' }
  | { t: 'acquire'; key: string; take: boolean }
  | { t: 'release'; key: string }
  | { t: 'flushed'; key: string }
  | { t: 'want-key'; commitment: string }
  | { t: 'answer-key'; to: string; nonce: string; pub: string }
  | { t: 'reveal-key'; pub: string; nonce: string }
  | { t: 'grant-key'; to: string; wrapped: string; generation: number }
  | { t: 'deny-key'; to: string }

/** What the hub says. */
export type FromHub =
  | { t: 'poke'; space: string; seq: number }
  | { t: 'granted'; key: string; fence: number; version: number; rotate: boolean }
  | { t: 'busy'; key: string; device: string; name: string }
  | { t: 'flush'; key: string; fence: number }
  | { t: 'lost'; key: string; device: string; name: string }
  | { t: 'free'; key: string }
  | { t: 'state'; key: string; version: number }
  /** This computer's request for the web key is held: the hub pairs by commitment. */
  | { t: 'key-asked' }
  | { t: 'key-wanted'; device: string; name: string; commitment: string }
  /** A computer from before the commitment asked, and has to be updated to pair. */
  | { t: 'key-wanted-old'; device: string; name: string }
  | { t: 'key-answered'; from: string; nonce: string; pub: string }
  | { t: 'key-revealed'; device: string; pub: string; nonce: string }
  | { t: 'key'; wrapped: string; generation: number }
  | { t: 'key-denied' }
  | { t: 'key-settled'; device: string }
  | { t: 'refused'; to: string; key: string | null; error: string }
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
const opaque = (value: unknown): value is string => text(value) && OPAQUE.test(value)
const device = (value: unknown): value is string => text(value) && DEVICE.test(value)
/** A key, a nonce or a commitment: base64, and short. */
const short = (value: unknown): value is string =>
  text(value) && value.length <= 128 && /^[A-Za-z0-9+/_=-]+$/.test(value)

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

    case 'granted':
      return opaque(one.key) && whole(one.fence) && whole(one.version)
        ? {
            t: 'granted',
            key: one.key,
            fence: one.fence,
            version: one.version,
            rotate: one.rotate === true,
          }
        : null

    case 'busy':
    case 'lost':
      return opaque(one.key) && device(one.device)
        ? { t: one.t, key: one.key, device: one.device, name: text(one.name) ? one.name : '' }
        : null

    case 'flush':
      return opaque(one.key) && whole(one.fence)
        ? { t: 'flush', key: one.key, fence: one.fence }
        : null

    case 'free':
      return opaque(one.key) ? { t: 'free', key: one.key } : null

    case 'state':
      return opaque(one.key) && whole(one.version)
        ? { t: 'state', key: one.key, version: one.version }
        : null

    case 'key-asked':
      return { t: 'key-asked' }

    case 'key-wanted':
      return device(one.device) && short(one.commitment)
        ? {
            t: 'key-wanted',
            device: one.device,
            name: text(one.name) ? one.name : '',
            commitment: one.commitment,
          }
        : null

    case 'key-wanted-old':
      return device(one.device)
        ? { t: 'key-wanted-old', device: one.device, name: text(one.name) ? one.name : '' }
        : null

    case 'key-answered':
      return device(one.from) && short(one.nonce) && short(one.pub)
        ? { t: 'key-answered', from: one.from, nonce: one.nonce, pub: one.pub }
        : null

    case 'key-revealed':
      return device(one.device) && short(one.pub) && short(one.nonce)
        ? { t: 'key-revealed', device: one.device, pub: one.pub, nonce: one.nonce }
        : null

    case 'key':
      return text(one.wrapped) && whole(one.generation) && one.generation >= 1
        ? { t: 'key', wrapped: one.wrapped, generation: one.generation }
        : null

    case 'key-denied':
      return { t: 'key-denied' }

    case 'terms':
      return { t: 'terms' }

    case 'ai':
      return { t: 'ai' }

    case 'key-settled':
      return device(one.device) ? { t: 'key-settled', device: one.device } : null

    case 'chat':
      return { t: 'chat', said: one }

    case 'refused':
      return text(one.to) && text(one.error)
        ? { t: 'refused', to: one.to, key: opaque(one.key) ? one.key : null, error: one.error }
        : null

    default:
      return null
  }
}
