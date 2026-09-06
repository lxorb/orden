// How often syncing goes looking. Quick just after something happened, then
// slower the longer nothing does, and slower still when the window is not on
// screen: a change nobody can see does not need fetching yet. Coming back to
// the window resets it, so it is fast exactly while it is being watched.
const POLL_BUSY = 20_000
const POLL_IDLE_MAX = 120_000
const POLL_HIDDEN_MAX = 600_000

/** After a local save, so an edit does not sit waiting for a slow timer. Long
 *  enough that a burst of saves becomes one pass. */
export const NUDGE_DELAY = 2_000

/** Spaces are made and renamed rarely. Asking on every pass was most of the
 *  traffic and almost none of the answers. */
export const RECONCILE_INTERVAL = 300_000

/** How long to wait before looking again. Doubles for every pass that found
 *  nothing, up to a cap that depends on whether anyone is there to see the
 *  answer. Its own module so it can be tested without starting a workspace. */
export function pollDelay(quiet: number, hidden: boolean): number {
  return Math.min(POLL_BUSY * 2 ** quiet, hidden ? POLL_HIDDEN_MAX : POLL_IDLE_MAX)
}
