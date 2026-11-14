import { isRecord } from '../platform/src/api'
import type { RootMoved } from './roots-moved'

export const HOME_CARRIED = 'orden:home-carried'

export interface Former {
  homes: RootMoved[]
  waiting: boolean
  dumped: boolean
  after: string | null
  carried?: boolean
}

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

async function relaunched(): Promise<boolean> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
  return true
}

export async function finishFormerHome(former: Former | null = formerSaid()): Promise<boolean> {
  if (former === null) return false
  const { invoke } = await import('../platform/src/api')
  if (former.waiting) {
    const kept = await invoke('keep_after_move', {
      text: JSON.stringify(everything(localStorage)),
    }).then(
      () => true,
      () => false,
    )
    return kept && !former.dumped && relaunched()
  }
  if (former.after !== null) await invoke('drop_after_move').catch(() => undefined)
  if (!former.carried) return false
  for (const one of former.homes) {
    await invoke<number>('rehome_snapshots', { from: one.from, to: one.to }).catch(() => 0)
  }
  return false
}
