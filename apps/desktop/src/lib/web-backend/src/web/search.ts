import type { Query } from '@orden/scan/search/query'
import { type Found, walkSearch } from '@orden/scan/search/walk'
import { normalise } from '../../../platform/src/api'
import { space } from './space-cache'

export async function searchRows(
  root: string,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[] = [],
  onNote: (relative: string) => void = () => undefined,
): Promise<void> {
  const base = normalise(root)
  const each = (visit: Parameters<typeof space.each>[1]) =>
    space.each(base, (note) => {
      onNote(note.relative)
      return visit(note)
    })
  await walkSearch(each, query, terms, limit, onFound, excluded)
}
