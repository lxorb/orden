import { ACCOUNT_INBOX, INBOX_NAME } from '@orden/bases/inbox'
import { homeRoot } from '../rows/home.svelte'
import { insideSpace, samePath } from '../space-paths'
import { readText } from '../workspace/in-turn'
import { type Hit, Matcher } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'

export async function inboxHits(root: string, query: Query, limit: number): Promise<Hit[]> {
  const home = homeRoot()
  if (home === null || !samePath(home, root)) return []
  const path = insideSpace(root, ACCOUNT_INBOX)
  const body = await readText(path)
  if (!body) return []
  return new Matcher(query).hits({ path, relative: ACCOUNT_INBOX, name: INBOX_NAME, body }, limit)
}
