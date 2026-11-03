/** The hits of a space's own inbox (#1044), which no walk of the crate's reads: it is
 *  hidden. Its own file, fetched with the first search, so the first paint carries
 *  none of it. */

import { INBOX_NAME, INBOX_PATH } from '@orden/bases/inbox'
import { insideSpace } from '../space-paths'
import { invoke } from '../tauri'
import { type Hit, Matcher } from './match'
import type { Query } from './query'

export async function inboxHits(root: string, query: Query, limit: number): Promise<Hit[]> {
  const path = insideSpace(root, INBOX_PATH)
  const body = await invoke<string>('read_note', { path }).catch(() => null)
  if (!body) return []
  return new Matcher(query).hits({ path, relative: INBOX_PATH, name: INBOX_NAME, body }, limit)
}
