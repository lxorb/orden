/** Asking a whole space for its hits, in the order the notes answer.
 *
 *  One call, however many notes: the parsed query goes over as a tree and the
 *  space is read once. What comes back arrives in handfuls rather than at the
 *  end, so the first rows are on screen while the last folder is still being
 *  read. In the app those handfuls are an event from the crate; in the browser
 *  the notes are already here and the callback is called straight. */

import { invoke, isNative } from '../tauri'
import type { Hit } from './match'
import type { Query } from './query'

const HITS = 'nib://search-hits'

/** Which search a handful belongs to. Typing outruns the disk, and answers to
 *  a word that is no longer in the field would otherwise land in the list. */
let asked = 0

export async function searchSpace(
  root: string,
  query: Query,
  limit: number,
  onHits: (hits: Hit[]) => void,
): Promise<void> {
  if (!isNative) {
    await invoke('search_space', { root, query, limit, hits: onHits })
    return
  }

  const id = ++asked
  const { listen } = await import('@tauri-apps/api/event')
  const stop = await listen<{ id: number; hits: Hit[] }>(HITS, (event) => {
    if (event.payload.id === id) onHits(event.payload.hits)
  })

  try {
    await invoke('search_space', { root, query, limit, id })
  } finally {
    stop()
  }
}
