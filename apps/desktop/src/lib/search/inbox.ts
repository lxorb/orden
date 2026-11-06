import { INBOX_NAME, INBOX_PATH } from '@orden/bases/inbox'
import { insideSpace } from '../space-paths'
import { invoke } from '../tauri'
import { type Hit, Matcher } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'

export async function inboxHits(root: string, query: Query, limit: number): Promise<Hit[]> {
  const path = insideSpace(root, INBOX_PATH)
  const body = await invoke<string>('read_note', { path }).catch(() => null)
  if (!body) return []
  return new Matcher(query).hits({ path, relative: INBOX_PATH, name: INBOX_NAME, body }, limit)
}
