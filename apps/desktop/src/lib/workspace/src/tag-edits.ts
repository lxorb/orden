import { type Change, changeOf, type Edit } from '@orden/scan/search/replace'
import { tagCuts, tagSpans } from '@orden/scan/search/tags'

export function tagChange(path: string, before: string, from: string, to: string | null): Change | null {
  const spans = to === null ? tagCuts(before, from) : tagSpans(before, from)
  if (!spans.length) return null

  const edits: Edit[] = []
  let reached = 0

  for (const span of spans) {
    const last = edits.at(-1)
    if (span.from < reached) {
      if (to === null && last && span.to > last.to) {
        last.to = span.to
        reached = span.to
      }
      continue
    }

    edits.push({
      from: span.from,
      to: span.to,
      insert: to === null ? '' : keptCase(before.slice(span.from, span.to), to),
    })
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

function keptCase(written: string, to: string): string {
  const had = written.split('/')
  const wanted = to.split('/')
  for (let at = 0; at < wanted.length && had[at]?.toLowerCase() === wanted[at]?.toLowerCase(); at++)
    wanted[at] = had[at] ?? ''
  return wanted.join('/')
}
