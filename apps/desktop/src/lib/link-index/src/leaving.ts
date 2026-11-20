import { insideSpace, samePath, within } from '../../platform/src/api'
import { retargetLinks } from './link-rewrite'
import { type links, readsWords, stillReaches } from './links.svelte'

export function leaving(
  index: typeof links,
  text: string,
  from: string,
  to: string,
  along?: string,
): { text: string; carry: { from: string; to: string }[] } | null {
  const home = index.topOf(from)
  const into = index.spaceOf(to)
  if (home === null || into === null || samePath(home, into)) return null
  const was = within(home, from)
  const now = within(into, to)
  if (!was || !now) return null
  const kept = along === undefined ? null : within(home, along)
  const carry = new Map<string, { from: string; to: string }>()
  const after = retargetLinks(text, now, (link) => {
    const there = index.reachedOf(from, link)
    if (there === null || readsWords(there)) return null
    if (kept !== null && (there === kept || there.startsWith(`${kept}/`))) return null
    carry.set(there, { from: insideSpace(home, there), to: insideSpace(into, there) })
    if (link.kind !== 'markdown' || stillReaches(now, link, there, false)) return null
    return there
  })
  return { text: after ?? text, carry: [...carry.values()] }
}
