import { type Anchor, oneEnding, type Place, readAnchor, resolve, type Selected } from './anchors'
import { isRecord } from '../../platform/src/api'
import { DocError } from './problem'

export interface Replacement {
  from: number
  to: number
  insert: string
}

type Doing =
  | { kind: 'replace'; words: string }
  | { kind: 'before'; words: string }
  | { kind: 'after'; words: string }
  | { kind: 'delete' }

export interface AgentEdit {
  at: Anchor
  doing: Doing
}

const MOST_EDITS = 500

function doingOf(edit: Record<string, unknown>): Doing {
  const said: Doing[] = []
  if (typeof edit.replace === 'string')
    said.push({ kind: 'replace', words: oneEnding(edit.replace) })
  if (typeof edit.insert_before === 'string') {
    said.push({ kind: 'before', words: oneEnding(edit.insert_before) })
  }
  if (typeof edit.insert_after === 'string') {
    said.push({ kind: 'after', words: oneEnding(edit.insert_after) })
  }
  if (edit.delete === true) said.push({ kind: 'delete' })

  const [only] = said
  if (!only || said.length > 1) {
    throw new DocError(
      'bad_edit',
      edit,
      'each edit does exactly one of replace, insert_before, insert_after and delete',
    )
  }
  return only
}

export function readEdits(value: unknown): AgentEdit[] {
  if (!Array.isArray(value) || !value.length) {
    throw new DocError('bad_edit', value, 'edits is a list of at least one edit')
  }
  if (value.length > MOST_EDITS) {
    throw new DocError('bad_edit', value.length, `at most ${MOST_EDITS} edits a call`)
  }

  return value.map((edit: unknown) => {
    if (!isRecord(edit)) throw new DocError('bad_edit', edit, 'an edit is an object')
    return { at: readAnchor(edit.at), doing: doingOf(edit) }
  })
}

function trailingBreaks(words: string): number {
  let count = 0
  while (words[words.length - 1 - count] === '\n') count++
  return count
}

function leadingBreaks(words: string): number {
  let count = 0
  while (words[count] === '\n') count++
  return count
}

function apartFromBefore(words: string, gap: number, text: string, at: number): string {
  if (at === 0) return words
  const have = trailingBreaks(text.slice(0, at)) + leadingBreaks(words)
  return '\n'.repeat(Math.max(0, gap - have)) + words
}

function apartFromAfter(words: string, gap: number, text: string, at: number): string {
  if (at === text.length) return words
  const have = trailingBreaks(words) + leadingBreaks(text.slice(at))
  return words + '\n'.repeat(Math.max(0, gap - have))
}

const CHILD_ITEM = /^([ \t]+)(?:[-*+]|\d+[.)])[ \t]/

function withKept(words: string, keep: string): string {
  const trimmed = words.replace(/\n+$/, '')
  if (keep.startsWith('\n')) return trimmed + keep
  const lines = trimmed.split('\n')
  const lead = /^[ \t]*/.exec(lines[0] ?? '')?.[0].length ?? 0
  const child = lines.findIndex(
    (line, at) => at > 0 && (CHILD_ITEM.exec(line)?.[1]?.length ?? 0) > lead,
  )
  if (child < 1) return trimmed + keep
  return [
    ...lines.slice(0, child - 1),
    `${lines[child - 1] ?? ''}${keep}`,
    ...lines.slice(child),
  ].join('\n')
}

const ITEM_LINE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/

function gapOf(place: Place, words: string): number {
  if (place.shape === 'words') return 0
  if (place.shape === 'item') return words && !ITEM_LINE.test(words.replace(/^\n+/, '')) ? 2 : 1
  return place.shape === 'line' ? 1 : 2
}

function indented(words: string, indent: string | undefined): string {
  if (!indent || words.replace(/^\n+/, '').startsWith(indent)) return words
  return words
    .split('\n')
    .map((line) => (line.trim() ? indent + line : line))
    .join('\n')
}

function placed(text: string, place: Place, doing: Doing): Replacement {
  const asked = doing.kind === 'delete' ? '' : indented(doing.words, place.indent)
  const gap = gapOf(place, asked)

  switch (doing.kind) {
    case 'replace': {
      const keep = place.keep && !asked.includes(place.keep.trim()) ? place.keep : ''
      const words = keep ? withKept(asked, keep) : asked
      return { from: place.from, to: place.to, insert: words }
    }

    case 'before':
    case 'after': {
      const at = doing.kind === 'before' ? place.from : (place.after ?? place.to)
      const edge = place.shape === 'edge'
      const atEnd = edge ? at === text.length : doing.kind === 'after'
      const apart = atEnd
        ? apartFromBefore(asked, gap, text, at)
        : apartFromAfter(asked, gap, text, at)
      const words = edge
        ? apart
        : atEnd
          ? apartFromAfter(apart, gap, text, at)
          : apartFromBefore(apart, gap, text, at)
      const ending = at === text.length && text.endsWith('\n') && !words.endsWith('\n')
      return { from: at, to: at, insert: ending ? `${words}\n` : words }
    }

    case 'delete': {
      if (place.shape === 'edge') {
        throw new DocError('bad_edit', place, 'the start and the end are places, not words')
      }
      if (!gap) return { from: place.from, to: place.to, insert: '' }

      let to = place.to
      while (to < text.length && text[to] === '\n' && to - place.to < gap) to++
      let from = place.from
      if (to === text.length) {
        while (from > 0 && text[from - 1] === '\n') from--
        if (from > 0 && text.endsWith('\n')) to = Math.max(from, to - 1)
      }
      return { from, to, insert: '' }
    }
  }
}

export interface Planned {
  edits: Replacement[]
  places: Place[]
}

export function plan(
  asked: readonly AgentEdit[],
  text: string,
  selected: Selected | null = null,
): Planned {
  const places = asked.map((edit) => resolve(edit.at, text, selected))
  const edits = asked
    .map((edit, index) => {
      const place = places[index] ?? { from: 0, to: 0, shape: 'words' as const }
      return { index, change: placed(text, place, edit.doing) }
    })
    .sort(
      (one, other) =>
        one.change.from - other.change.from ||
        one.change.to - other.change.to ||
        one.index - other.index,
    )

  for (let at = 1; at < edits.length; at++) {
    const before = edits[at - 1]
    const after = edits[at]
    if (!before || !after || after.change.from >= before.change.to) continue

    throw new DocError(
      'overlapping',
      [asked[before.index]?.at, asked[after.index]?.at],
      'two of the edits change the same words',
    )
  }

  return { edits: edits.map((one) => one.change), places }
}
