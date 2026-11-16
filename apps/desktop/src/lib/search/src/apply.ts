import { isMarkdownPath, relativeTo } from '../../platform/src/api'
import { lineStarts } from '@orden/scan/search/lines'
import { type Hit, Matcher, shownLine } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'
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

  const scoped = query.of.find((one) => one.kind === 'scope' && one.of.kind === 'text')
  if (scoped?.kind === 'scope' && query.of.some((one) => one.kind === 'text')) {
    const inner: Query = {
      kind: 'all',
      of: query.of.flatMap((one) =>
        one === scoped ? [scoped.of] : one.kind === 'text' ? [one] : [],
      ),
    }
    return phrased({
      ...query,
      of: query.of.flatMap((one) =>
        one === scoped ? [{ ...scoped, of: inner }] : one.kind === 'text' ? [] : [one],
      ),
    })
  }

  const of = joined(joined(query.of, 'text'), 'content')
  return { ...query, of: of.map(phrased) }
}

function joined(of: Query[], kind: Words['kind']): Query[] {
  const words = of.filter((one): one is Words => one.kind === kind)
  const first = words[0]
  if (!first || words.length < 2 || words.some((one) => one.fold !== first.fold)) return of
  const phrase: Query = { ...first, text: words.map((one) => one.text).join(' ') }
  return of.flatMap((one) => (one === first ? [phrase] : one.kind === kind ? [] : [one]))
}

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
