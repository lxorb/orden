const POLL_BUSY = 20_000
const POLL_IDLE_MAX = 120_000
const POLL_HIDDEN_MAX = 600_000

export const NUDGE_DELAY = 2_000

export function nudgeDelay(left: number): number {
  return Math.min(NUDGE_DELAY, Math.max(0, left))
}

export const RECONCILE_INTERVAL = 300_000

export function pollDelay(quiet: number, hidden: boolean): number {
  return Math.min(POLL_BUSY * 2 ** quiet, hidden ? POLL_HIDDEN_MAX : POLL_IDLE_MAX)
}

const ROOM_FIRST = 400
const ROOM_MAX = 20_000

const ROOM_SPREAD = 0.3

export function roomDelay(tries: number, spread = Math.random()): number {
  const wait = Math.min(ROOM_FIRST * 2 ** Math.max(0, tries - 1), ROOM_MAX)
  return Math.round(wait * (1 + ROOM_SPREAD * (spread * 2 - 1)))
}

const LINK_FIRST = 250
const LINK_MAX = 5_000

export function linkDelay(tries: number, hidden: boolean, spread = Math.random()): number {
  const most = hidden ? ROOM_MAX : LINK_MAX
  const wait = Math.min(LINK_FIRST * 2 ** Math.max(0, tries - 1), most)
  return Math.round(wait * (1 + ROOM_SPREAD * (spread * 2 - 1)))
}

export const SAVE_DELAY = 400

export const SAVE_AT_MOST = 2000

export function saveRetryDelay(tries: number): number {
  return Math.min(2_000 * 2 ** Math.max(0, tries - 1), 60_000)
}

export const BEAT_EVERY = 10_000

export const IDLE_AFTER = 5 * 60_000

export const INPUT_EVERY = 30_000

export const PRESENCE_EVERY = 60_000

export function passing(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}
