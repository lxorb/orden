/** How the runner goes through its spaces: one space's trouble is that space's.
 *
 *  A pass that throws for one space left the loop over all of them, so the spaces after
 *  it were not synced that round, and on the way back to v1 it kept every space on this
 *  device waiting for one the account no longer reaches. Here, where a test can hold it
 *  without the window around the runner. */

import { ApiError } from '../api'
import { Refused } from './transport'

function statusOf(error: unknown): number | null {
  return error instanceof Refused || error instanceof ApiError ? error.status : null
}

/** The account saying this space is not this person's to reach. */
function outOfReach(error: unknown): boolean {
  const status = statusOf(error)
  return status === 403 || status === 404
}

/** Takes every space off `due`, each in its turn. The session having ended is everybody's
 *  answer and stops at once; anything else waits until the rest have had their turn, and
 *  is thrown then, the first of them, for the runner to say. */
export async function eachDue(
  due: Set<string>,
  alive: () => boolean,
  one: (id: string) => Promise<void>,
): Promise<void> {
  let failed: { error: unknown } | null = null
  while (due.size && alive()) {
    const [id] = due
    if (id === undefined) break
    due.delete(id)
    try {
      await one(id)
    } catch (error) {
      if (statusOf(error) === 401) throw error
      failed ??= { error }
    }
  }
  if (failed) throw failed.error
}

interface Sending {
  pass(id: string): Promise<{ finished: boolean } | null>
  waiting(id: string): boolean
}

/** Passes over the spaces until nothing in them waits to go up, or a few rounds have
 *  gone by. Answers false where the account could not be reached. What still waits
 *  after that - refused, or held for the question - is left to v1's own judgement,
 *  through the words the mirrors say this device confirmed.
 *
 *  A space the account refuses has nothing that can go: whether it is out of reach for
 *  good is the listing's to say (`reachable`), and the other spaces do not wait to hear
 *  it. */
export async function sentAll(
  engine: Sending,
  spaces: ReadonlySet<string>,
  rounds: number,
  settling: () => Promise<unknown>,
): Promise<boolean> {
  const refused = new Set<string>()
  for (let round = 0; round < rounds; round += 1) {
    if (round) await settling()
    for (const id of spaces) {
      if (refused.has(id)) continue
      try {
        const passed = await engine.pass(id)
        if (!passed?.finished) return false
      } catch (error) {
        if (!outOfReach(error)) throw error
        refused.add(id)
      }
    }
    if (![...spaces].some((id) => !refused.has(id) && engine.waiting(id))) return true
  }
  return true
}

/** Each space's listing, and the spaces the account answers none for: taken out of a
 *  shared space, or the space erased, while this device was closed. There is no mirror
 *  to write for one, and nothing it holds to send anywhere. Its files stay on the disk. */
export async function reachable<T>(
  spaces: ReadonlySet<string>,
  listing: (id: string) => Promise<T>,
): Promise<{ listings: ReadonlyMap<string, T>; gone: ReadonlySet<string> }> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once on the way back; nothing renders from it
  const listings = new Map<string, T>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- the same
  const gone = new Set<string>()
  for (const id of spaces) {
    try {
      listings.set(id, await listing(id))
    } catch (error) {
      if (!outOfReach(error)) throw error
      gone.add(id)
    }
  }
  return { listings, gone }
}
