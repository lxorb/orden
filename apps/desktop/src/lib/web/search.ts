import type { Query } from '@orden/scan/search/query'
import { type Found, walkSearch } from '@orden/scan/search/walk'
import { normalise } from '../platform/src/api'
import { space } from './space-cache'

export async function searchRows(
  root: string,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[] = [],
): Promise<void> {
  const base = normalise(root)
  await walkSearch((visit) => space.each(base, visit), query, terms, limit, onFound, excluded)
}
