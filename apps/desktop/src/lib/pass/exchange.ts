import type { SyncWorld } from './sync-world'
import { appliedChanges, appliedItems } from './pull'
import { pushed } from './push'
import { NoPass } from './sync'
import { cursorOf, keepCursor } from './synced'

export type Outcome = 'synced' | 'old-server' | 'conflict' | 'other-account'

const ROUNDS = 3

type Pass = 'pulled' | 'conflict' | 'deferred'

async function pulledAll(world: SyncWorld, from: number): Promise<Pass> {
  let since = from
  for (;;) {
    const changes = await world.api.changes(since)
    const applied = await world.exclusive((held) => appliedChanges(world, held, changes, since))
    if (applied.pulled !== 'pulled') return applied.pulled
    for (const vault of applied.fresh) {
      const items = await world.api.allVaultItems(vault)
      await world.exclusive((held) => appliedItems(world, held, items))
    }
    await keepCursor(world.rows, { account: world.account, seq: changes.seq })
    since = changes.seq
    if (!changes.more) return 'pulled'
  }
}

async function exchanged(world: SyncWorld): Promise<Outcome> {
  const cursor = await cursorOf(world.rows)
  if (cursor && cursor.account !== world.account) return 'other-account'
  for (let round = 0; round < ROUNDS; round++) {
    const sent = await pushed(world)
    if (sent === 'conflict') return 'conflict'
    const seq = (await cursorOf(world.rows))?.seq ?? 0
    const took = await pulledAll(world, seq)
    if (took === 'conflict') return 'conflict'
    if (sent !== 'again') return 'synced'
  }
  return 'synced'
}

export async function syncOnce(world: SyncWorld): Promise<Outcome> {
  try {
    return await exchanged(world)
  } catch (error) {
    if (error instanceof NoPass) return 'old-server'
    throw error
  }
}
