import { inForeignCopy } from '@orden/sync-core'
import { account } from '../accounts/src/api'
import { api, fromServer } from '../accounts/src/api'
import { log } from '../log'
import { stored } from '../stored'
import { type Mirror, savedRecord } from '../sync/mirror'
import { STORAGE_KEY, sync } from '../sync.svelte'
import type { Engine, ForeignCopies } from '../sync-client/src/api'

export interface Synced {
  count: number
  remove(): Promise<void>
}

export function syncedCopies(engine: Engine | null): Synced {
  if (!engine) return fromMirrors()
  if (!engine.copies) return { count: 0, remove: () => Promise.resolve() }
  return fromTree(engine.copies)
}

function fromTree(engine: ForeignCopies): Synced {
  return {
    count: engine.foreignCopies().length,
    remove: async () => {
      await engine.unsync()
      sync.nudge()
    },
  }
}

function fromMirrors(): Synced {
  const ids = savedMirrors(stored(STORAGE_KEY), account.user?.id ?? null).flatMap((mirror) =>
    Object.entries(mirror.notes).flatMap(([path, one]) => (inForeignCopy(path) ? [one.id] : [])),
  )
  return {
    count: ids.length,
    remove: async () => {
      const token = account.accountToken
      if (!token) return
      for (const id of ids) await deleted(token, id)
      sync.nudge()
    },
  }
}

async function deleted(token: string, id: string) {
  try {
    await api.deleteNote(token, id)
  } catch (error) {
    if (fromServer(error) && (error.status === 403 || error.status === 404)) return
    log('warn', `sync: a conflict copy ${id} stayed on the account - ${String(error)}`)
  }
}

function savedMirrors(saved: unknown, accountId: string | null): Mirror[] {
  const record = savedRecord(saved)
  if (!record || (record.whose !== null && record.whose !== accountId)) return []
  return Object.values(record.mirrors)
}
