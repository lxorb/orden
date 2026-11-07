import { isRecord, keep, parsed, storedText } from '../stored'
import { invoke } from '../tauri'
import { joined, restate } from './moved'
import { noteRootsMoved, type RootMoved } from './roots-moved'

export const HOME_CARRIED = 'orden:home-carried'

interface Former {
  homes: RootMoved[]
  waiting: boolean
  dumped: boolean
  after: string | null
}

function everything(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {}
  for (let at = 0; at < storage.length; at++) {
    const key = storage.key(at)
    const value = key === null || key === HOME_CARRIED ? null : storage.getItem(key)
    if (key !== null && value !== null) out[key] = value
  }
  return out
}

export function takeAfterMove(text: string, storage: Storage = localStorage): number {
  const said = parsed(text)
  if (!isRecord(said)) return 0
  let changed = 0
  for (const [key, value] of Object.entries(said)) {
    if (typeof value !== 'string' || key === HOME_CARRIED) continue
    const had = storage.getItem(key)
    const before = parsed(had)
    const after = parsed(value)
    const both = typeof before === 'object' && before !== null && typeof after === 'object'
    const next =
      had !== null && both && after !== null ? JSON.stringify(joined(before, after)) : value
    if (next === had) continue
    storage.setItem(key, next)
    changed++
  }
  return changed
}

async function relaunched(): Promise<boolean> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
  return true
}

export async function carryFormerHome(): Promise<boolean> {
  const former = await invoke<Former>('former_homes').catch(() => null)
  if (former === null) return false
  if (former.waiting) {
    const kept = await invoke('keep_after_move', {
      text: JSON.stringify(everything(localStorage)),
    }).then(
      () => true,
      () => false,
    )
    return kept && !former.dumped && relaunched()
  }
  let changed = 0
  if (former.after !== null) {
    changed += takeAfterMove(former.after)
    await invoke('drop_after_move').catch(() => undefined)
  }
  if (storedText(HOME_CARRIED) !== null) return changed > 0
  for (const one of former.homes) {
    changed += restate(one.from, one.to)
    await invoke<number>('rehome_snapshots', { from: one.from, to: one.to }).catch(() => 0)
  }
  noteRootsMoved(former.homes)
  keep(HOME_CARRIED, '1')
  return changed > 0
}
