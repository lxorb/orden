import { isMarkdownPath, relativeTo } from '../space-paths'
import { type Hit, Matcher } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'
import { changeOf, type Edit, replaceIn } from './replace'

export interface Change {
  path: string
  before: string
  after: string
  edits: Edit[]
  back: Edit[]
}

function linesPerNote(hits: readonly Hit[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()

  for (const hit of hits) {
    const held = out.get(hit.path)
    if (held) held.add(hit.line)
    else out.set(hit.path, new Set([hit.line]))
  }

  return out
}

export async function changesFor(
  query: Query,
  hits: readonly Hit[],
  replacement: string,
  root: string,
  textOf: (path: string) => Promise<string | null>,
): Promise<Change[]> {
  const matcher = new Matcher(query)
  const out: Change[] = []

  for (const [path, lines] of linesPerNote(hits)) {
    if (!isMarkdownPath(path)) continue

    const before = await textOf(path)
    if (before === null) continue

    const relative = relativeTo(root, path)
    const name = relative.split('/').pop() ?? relative
    const spans = matcher.spans({ path, relative, name, body: before })
    if (!spans) continue

    const edits = replaceIn(before, spans, lines, replacement)
    if (edits) out.push(changeOf(path, before, edits))
  }

  return out
}
