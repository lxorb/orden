import { workspace } from '../workspace.svelte'
import type { NoteDoc } from '../workspace/documents.svelte'
import { isDraft } from '../workspace/drafts'
import { type Hit, Matcher } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'

export function unsavedHits(query: Query, space: string | null, most: number): Hit[] {
  const matcher = new Matcher(query)
  const seen = new Set<NoteDoc>()
  const out: Hit[] = []

  for (const tab of workspace.tabs) {
    const note = tab.note
    if (seen.has(note) || note.kind !== 'note' || !isDraft(note)) continue
    if (workspace.spaceOf(note) !== space) continue
    seen.add(note)

    const found = matcher.hits(
      { path: `unsaved:${note.key}`, relative: note.shown, name: note.shown, body: note.latest },
      most - out.length,
    )
    out.push(...found.map((hit) => ({ ...hit, tab: tab.id })))
  }

  return out
}
