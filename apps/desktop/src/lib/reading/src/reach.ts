import { findLinks, type LinkKind } from '@orden/markdown/links'

export interface Reaching {
  readonly version: number
  reachedOf(from: string | null, link: { kind: LinkKind; target: string }): string | null
}
const ASKS = /```(?:query|tasks)|!\[\[/
export function reachKey(doc: string, path: string | null, index: Reaching): string {
  if (ASKS.test(doc)) return `${index.version}`
  return findLinks(doc)
    .map((link) => index.reachedOf(path, link) ?? '')
    .join('\n')
}
