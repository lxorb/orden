import { type Anchor, oneEnding, type Place, readAnchor, resolve, type Selected } from './anchors'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

function gapOf(place: Place): number {
  if (place.shape === 'words') return 0
  return place.shape === 'line' ? 1 : 2
}

function placed(text: string, place: Place, doing: Doing): Replacement {
  const gap = gapOf(place)

  switch (doing.kind) {
    case 'replace': {
      const keep = place.keep && !doing.words.includes(place.keep.trim()) ? place.keep : ''
      const words = keep ? doing.words.replace(/\n+$/, '') + keep : doing.words
      return { from: place.from, to: place.to, insert: words }
    }

    case 'before':
    case 'after': {
      const at = doing.kind === 'before' ? place.from : place.to
      const edge = place.shape === 'edge'
      const atEnd = edge ? at === text.length : doing.kind === 'after'
      const words = atEnd
        ? apartFromBefore(doing.words, gap, text, at)
        : apartFromAfter(doing.words, gap, text, at)
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
