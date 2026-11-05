import { ApiError } from '../api'
import { Refused } from './transport'

function statusOf(error: unknown): number | null {
  return error instanceof Refused || error instanceof ApiError ? error.status : null
}

function outOfReach(error: unknown): boolean {
  const status = statusOf(error)
  return status === 403 || status === 404
}

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

export async function reachable<T>(
  spaces: ReadonlySet<string>,
  listing: (id: string) => Promise<T>,
  listed: () => Promise<readonly string[]>,
): Promise<{ listings: ReadonlyMap<string, T>; gone: ReadonlySet<string> }> {
  const listings = new Map<string, T>()
  const refused: string[] = []
  for (const id of spaces) {
    try {
      listings.set(id, await listing(id))
    } catch (error) {
      if (!outOfReach(error)) throw error
      refused.push(id)
    }
  }
  if (!refused.length) return { listings, gone: new Set() }
  const held = new Set(await listed())
  return { listings, gone: new Set(refused.filter((id) => !held.has(id))) }
}
