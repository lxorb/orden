import { isMarkdownPath, relativeTo } from '../../platform/src/api'
import { lineStarts } from '@orden/scan/search/lines'
import { type Hit, Matcher, shownLine } from '@orden/scan/search/match'
import { aKindOfLine, type Query, type Unit } from '@orden/scan/search/query'
import { type Change, changeOf, replaceIn } from '@orden/scan/search/replace'

function hitsPerNote(hits: readonly Hit[]): Map<string, Hit[]> {
  const out = new Map<string, Hit[]>()
  for (const hit of hits) {
    const held = out.get(hit.path)
    if (held) held.push(hit)
    else out.set(hit.path, [hit])
  }
  return out
}
function linesNow(body: string, hits: readonly Hit[]): Set<number> {
  const starts = lineStarts(body)
  const says = (line: number) => {
    const from = starts[line]
    if (from === undefined) return null
    const next = starts[line + 1]
    return shownLine(body.slice(from, next === undefined ? body.length : next - 1))
  }
  const out = new Set<number>()
  for (const hit of hits) {
    for (let distance = 0; distance < starts.length; distance++) {
      if (says(hit.line - distance) === hit.text) {
        out.add(hit.line - distance)
        break
      }
      if (distance && says(hit.line + distance) === hit.text) {
        out.add(hit.line + distance)
        break
      }
    }
  }
  return out
}
type Words = Extract<Query, { kind: 'text' | 'content' }>
function phrased(query: Query): Query {
  if (query.kind === 'scope') return { ...query, of: phrased(query.of) }
  if (query.kind === 'any') return { ...query, of: query.of.map(phrased) }
  if (query.kind !== 'all') return query
  const out: Query[] = []
  for (let at = 0; at < query.of.length; at++) {
    const one = query.of[at]
    if (!one) continue
    const words = one.kind === 'scope' && oneLine(one.unit) ? one.of : one
    if (words.kind !== 'text' && words.kind !== 'content') {
      out.push(phrased(one))
      continue
    }
    let text = words.text
    for (let next = query.of[at + 1]; followsAs(next, words); next = query.of[++at + 1]) {
      text += ` ${next.text}`
    }
    const phrase: Query = { ...words, text }
    out.push(one.kind === 'scope' ? { ...one, of: phrase } : phrase)
  }
  return { ...query, of: out }
}
const followsAs = (next: Query | undefined, words: Words): next is Words =>
  (next?.kind === 'text' || next?.kind === 'content') && next.fold === words.fold
const oneLine = (unit: Unit): boolean => unit === 'line' || aKindOfLine(unit)
export async function changesFor(
  query: Query,
  hits: readonly Hit[],
  replacement: string,
  root: string,
  textOf: (path: string) => Promise<string | null>,
): Promise<Change[]> {
  const matcher = new Matcher(phrased(query))
  const out: Change[] = []
  for (const [path, held] of hitsPerNote(hits)) {
    if (!isMarkdownPath(path)) continue
    const before = await textOf(path)
    if (before === null) continue
    const relative = relativeTo(root, path)
    const name = relative.split('/').pop() ?? relative
    const spans = matcher.spans({ path, relative, name, body: before })
    if (!spans) continue
    const edits = replaceIn(before, spans, linesNow(before, held), replacement)
    if (edits) out.push(changeOf(path, before, edits))
  }
  return out
}
