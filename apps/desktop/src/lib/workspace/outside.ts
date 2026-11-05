/** A spaces folder pointed outside Orden's own by a hand-edited `spaces-folder` (#552):
 *  an Obsidian vault, or any folder Orden did not make. Orden never uses such a folder
 *  in place; the crate copies its spaces into Orden's own folder once and leaves it as
 *  it was (src-tauri/src/outside.rs). Here, before anything has read its storage, every
 *  path stored under a space taken in is said again under the root it has now, as a
 *  phone's moved container is (moved.ts): its id, tabs, bookmarks and versions follow
 *  it, and the sync engine follows as it starts (roots-moved.ts). Then the crate writes
 *  its own folder as the spaces folder, unless a space could not be copied, which is
 *  tried again at the next launch. Fetched only where the crate said there is such a
 *  folder (early.ts, main.ts). */

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

/** The spaces of the folder outside taken in. Answers whether the page is to start over:
 *  where stored paths were said again, and where every space came in, since what the
 *  crate read ahead for the launch was read before the copies were there. Not where some
 *  are still left and nothing was said again, which would start it over at every turn. */
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
