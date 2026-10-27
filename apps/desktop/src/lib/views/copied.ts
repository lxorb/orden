/** What a copy leaves behind: the ids of the bases of its space, which the runner knows
 *  and says here once it runs (running.ts). Apart from the runner so that copying, which
 *  every window can do, does not fetch it; until it runs, no base numbers anything. */

let leaving: ((path: string, text: string) => string | null) | null = null

/** The runner's rule, from when it starts. */
export function leaveIdsBy(rule: (path: string, text: string) => string | null) {
  leaving = rule
}

/** A copy's words without those ids, or null where it holds none. */
export function withoutIds(path: string, text: string): string | null {
  return leaving ? leaving(path, text) : null
}
