import { scratchpad } from '../scratchpad/pad'
import { SCRATCHPAD } from '../scratchpad/is.svelte'
import { noteName } from '../space-paths'
import { type Hit, Matcher } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'

export async function scratchpadHits(query: Query, most: number): Promise<Hit[]> {
  const path = await scratchpad.where().catch(() => null)
  const body = path === null ? '' : await scratchpad.text()
  if (path === null || !body.trim()) return []

  const name = noteName(SCRATCHPAD)
  return new Matcher(query).hits({ path, relative: name, name, body }, most)
}
