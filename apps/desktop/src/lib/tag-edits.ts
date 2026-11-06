import type { Change } from './search/apply'
import { changeOf, type Edit } from './search/replace'
import { tagCuts, tagSpans } from '@orden/scan/search/tags'

export function tagChange(
  path: string,
  before: string,
  from: string,
  to: string | null,
): Change | null {
  const spans = to === null ? tagCuts(before, from) : tagSpans(before, from)
  if (!spans.length) return null

  const edits: Edit[] = []
  let reached = 0

  for (const span of spans) {
    if (span.from < reached) continue

    edits.push({ from: span.from, to: span.to, insert: to ?? '' })
    reached = span.to
  }

  if (!edits.length) return null

  const change = changeOf(path, before, edits)
  return change.after === before ? null : change
}

export async function tagChanges(
  paths: readonly string[],
  from: string,
  to: string | null,
  textOf: (path: string) => Promise<string | null>,
): Promise<Change[]> {
  const out: Change[] = []

  for (const path of paths) {
    const before = await textOf(path)
    if (before === null) continue

    const change = tagChange(path, before, from, to)
    if (change) out.push(change)
  }

  return out
}
