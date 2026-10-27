/** What a copy leaves behind: the ids of the bases it lands in, which the runner knows
 *  and says here once it runs (running.ts). Apart from the runner so that copying, which
 *  every window can do, does not fetch it; until it runs, no base numbers anything. */

/** The runner's rule: whether any base of the space holding a path numbers its rows,
 *  and a copy's words without the ids of the bases it is a row of. */
interface Rule {
  numbers(path: string): boolean
  without(path: string, text: string): string | null
}

let rule: Rule | null = null

/** The runner's rule, from when it starts. */
export function leaveIdsBy(given: Rule) {
  rule = given
}

/** Whether a copy landing at `path` could hold an id to leave behind. */
export function numbersAt(path: string): boolean {
  return rule?.numbers(path) ?? false
}

/** A copy's words without those ids, or null where it holds none. */
export function withoutIds(path: string, text: string): string | null {
  return rule ? rule.without(path, text) : null
}
