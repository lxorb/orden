import { fit } from '@orden/scan/search/fuzzy'

export type MentionKind =
  | 'note'
  | 'folder'
  | 'tag'
  | 'tab'
  | 'selection'
  | 'scratchpad'
  | 'thread'
  | 'web'
  | 'picture'
  | 'words'

export interface Mention {
  kind: MentionKind
  id: string
  label: string
  word?: string
  image?: { mime: string; data: string }
  text?: string
  from?: string
  theirs?: boolean
  space?: string
}

export interface Row {
  key: string
  label: string
  hint?: string
  mark?: MentionKind
  dim?: string
}

const MOST = 8

function scoreOf(mention: Mention, query: string): number | null {
  const scores = [mention.label, mention.word ?? '']
    .filter(Boolean)
    .map((text) => {
      const found = fit(query, text)
      if (!found) return null
      const starts = text.toLowerCase().startsWith(query.toLowerCase()) ? 1_000 : 0
      return found.score + starts
    })
    .filter((one): one is number => one !== null)
  return scores.length ? Math.max(...scores) : null
}

export function ranked(candidates: readonly Mention[], query: string, most = MOST): Mention[] {
  const typed = query.trim()
  if (!typed) return candidates.slice(0, most)
  return candidates
    .map((one, at) => ({ one, at, score: scoreOf(one, typed) }))
    .filter((row): row is { one: Mention; at: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, most)
    .map((row) => row.one)
}

export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const before = text.slice(0, caret)
  const found = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (!found) return null
  const query = found[1] ?? ''
  return { from: caret - query.length - 1, query }
}

export function mentionOf(entry: { path: string; name: string; is_dir: boolean }): Mention {
  return entry.is_dir
    ? { kind: 'folder', id: entry.path, label: `${entry.name}/` }
    : { kind: 'note', id: entry.path, label: entry.name.replace(/\.(?:md|markdown)$/i, '') }
}

export function sameMention(one: Mention, other: Mention): boolean {
  return one.kind === other.kind && one.id === other.id
}
