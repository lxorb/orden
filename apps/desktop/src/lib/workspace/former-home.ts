import { isRecord, keep, parsed, storedText } from '../stored'
import { joined, restate } from './moved'
import { noteRootsMoved, type RootMoved } from './roots-moved'

export const HOME_CARRIED = 'orden:home-carried'

export interface Former {
  homes: RootMoved[]
  waiting: boolean
  dumped: boolean
  after: string | null
}

const left: { rehome: RootMoved[]; took: boolean } = { rehome: [], took: false }

export function formerSaid(): Former | null {
  const said = (globalThis as { __ORDEN_FORMER__?: unknown }).__ORDEN_FORMER__
  if (!isRecord(said) || !Array.isArray(said.homes)) return null
  return said as unknown as Former
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

export function carryFormerNow(former: Former | null = formerSaid()): void {
  if (former === null || former.waiting) return
  if (former.after !== null) {
    takeAfterMove(former.after)
    left.took = true
  }
  if (storedText(HOME_CARRIED) !== null) return
  for (const one of former.homes) restate(one.from, one.to)
  noteRootsMoved(former.homes)
  keep(HOME_CARRIED, '1')
  left.rehome = former.homes
}

async function relaunched(): Promise<boolean> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
  return true
}

export async function finishFormerHome(former: Former | null = formerSaid()): Promise<boolean> {
  if (former === null) return false
  const { invoke } = await import('../tauri')
  if (former.waiting) {
    const kept = await invoke('keep_after_move', {
      text: JSON.stringify(everything(localStorage)),
    }).then(
      () => true,
      () => false,
    )
    return kept && !former.dumped && relaunched()
  }
  if (left.took) await invoke('drop_after_move').catch(() => undefined)
  for (const one of left.rehome) {
    await invoke<number>('rehome_snapshots', { from: one.from, to: one.to }).catch(() => 0)
  }
  left.took = false
  left.rehome = []
  return false
}
