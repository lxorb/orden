import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  findClusterBreak,
  type Line,
  type StateCommand,
} from '@codemirror/state'
import { type Lines, linesOf } from './commands'
import { frontMatterSpan } from './live-preview/front-matter'

function firstOfBody(state: EditorState, number: number): number {
  const front = frontMatterSpan(state)
  const below = front ? state.doc.lineAt(front.after).number : 1
  return number >= below ? below : 1
}

const blank = (line: Line) => line.text.trim() === ''

function runAround(state: EditorState, number: number): Lines {
  const doc = state.doc
  const top = firstOfBody(state, number)
  let first = number
  let last = number
  while (first > top && !blank(doc.line(first - 1))) first--
  while (last < doc.lines && !blank(doc.line(last + 1))) last++
  return { first, last }
}

function blocksOf(state: EditorState, around: boolean): Lines[] {
  const found = state.selection.ranges
    .map((range) => {
      const lines = linesOf(state, range.from, range.to)
      return around && lines.first === lines.last ? runAround(state, lines.first) : lines
    })
    .sort((one, other) => one.first - other.first)

  const merged: Lines[] = []
  for (const lines of found) {
    const previous = merged.at(-1)
    if (previous && lines.first <= previous.last) {
      previous.last = Math.max(previous.last, lines.last)
    } else {
      merged.push({ ...lines })
    }
  }
  return merged
}

const LEAD = /^[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/

let collator: Intl.Collator | null = null

function compare(one: string, other: string): number {
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return collator.compare(one.replace(LEAD, ''), other.replace(LEAD, ''))
}

function reordered(reorder: (lines: string[]) => string[]): StateCommand {
  return ({ state, dispatch }) => {
    const doc = state.doc
    const blocks = blocksOf(state, true).filter((lines) => lines.last > lines.first)
    if (!blocks.length) return false

    const changes: ChangeSpec[] = []
    const ranges = blocks.map(({ first, last }) => {
      const from = doc.line(first).from
      const to = doc.line(last).to
      const lines: string[] = []
      for (let number = first; number <= last; number++) lines.push(doc.line(number).text)

      changes.push({ from, to, insert: reorder(lines).join(state.lineBreak) })
      return EditorSelection.range(from, to)
    })

    dispatch(
      state.update({
        changes,
        selection: EditorSelection.create(ranges),
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
    return true
  }
}

export const sortLines = reordered((lines) => [...lines].sort(compare))

export const reverseLines = reordered((lines) => [...lines].reverse())

export const deleteLine: StateCommand = ({ state, dispatch }) => {
  const doc = state.doc
  const { head } = state.selection.main
  const column = head - doc.lineAt(head).from
  const changes: ChangeSpec[] = []
  const carets: number[] = []

  for (const { first, last } of blocksOf(state, false)) {
    const from = last < doc.lines ? doc.line(first).from : Math.max(0, doc.line(first).from - 1)
    const to = last < doc.lines ? doc.line(last + 1).from : doc.line(last).to
    changes.push({ from, to })
    carets.push(from)
  }

  const set = state.changes(changes)
  const after = set.apply(doc)
  const ranges = carets.map((at) => {
    const line = after.lineAt(set.mapPos(at, 1))
    const along = findClusterBreak(line.text, Math.min(column, line.length) + 1, false)
    return EditorSelection.cursor(line.from + along)
  })

  dispatch(
    state.update({
      changes: set,
      selection: EditorSelection.create(ranges),
      scrollIntoView: true,
      userEvent: 'delete.line',
    }),
  )
  return true
}

export const joinLines: StateCommand = ({ state, dispatch }) => {
  const doc = state.doc
  const changes: ChangeSpec[] = []
  const carets: number[] = []

  for (const { first, last } of blocksOf(state, false)) {
    const end = first === last ? Math.min(last + 1, doc.lines) : last
    for (let number = first; number < end; number++) {
      const line = doc.line(number)
      const next = doc.line(number + 1)
      const lead = LEAD.exec(next.text)?.[0].length ?? 0
      const spaced = /\s$/.test(line.text) || next.text.length === lead || !line.text ? '' : ' '
      changes.push({ from: line.to, to: next.from + lead, insert: spaced })
      carets.push(line.to)
    }
  }
  if (!changes.length) return false

  const set = state.changes(changes)
  dispatch(
    state.update({
      changes: set,
      selection: EditorSelection.create(
        state.selection.ranges.length > 1 || !state.selection.main.empty
          ? state.selection.ranges.map((range) => range.map(set))
          : [EditorSelection.cursor(set.mapPos(carets.at(-1) ?? 0, 1))],
      ),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

export const insertLineAbove: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const indent = /^[ \t]*/.exec(line.text)?.[0] ?? ''
    return {
      changes: { from: line.from, insert: indent + state.lineBreak },
      range: EditorSelection.cursor(line.from + indent.length),
    }
  })

  dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
  return true
}
