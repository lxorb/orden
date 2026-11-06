import { log } from '../log'
import { keepJson } from '../stored'
import { invoke } from '../tauri'
import { restate } from './moved'
import { OUTSIDE } from '../surfaces.svelte'
import { noteRootsMoved, type RootMoved } from './roots-moved'

interface TakenIn {
  folder: string
  moved: RootMoved[]
  left: string[]
}

export async function takeIn(): Promise<boolean> {
  const taken = await invoke<TakenIn | null>('take_in_outside').catch((error: unknown) => {
    log('error', `the spaces folder outside Orden's own: ${String(error)}`)
    return null
  })
  if (!taken) return false
  let restated = 0
  for (const { from, to } of taken.moved) {
    restated += restate(from, to)
    await invoke<number>('rehome_snapshots', { from, to }).catch(() => 0)
  }
  noteRootsMoved(taken.moved)
  keepJson(OUTSIDE, { folder: taken.folder, left: taken.left })
  if (taken.left.length) return restated > 0
  const settled = await invoke('settle_outside').then(
    () => true,
    () => false,
  )
  return restated > 0 || (settled && taken.moved.length > 0)
}
