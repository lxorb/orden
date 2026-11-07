import type { ChangeSpec, Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { TextEdit } from '@orden/markdown/edits'
import type { TaskHelp } from './wikilink/notes'

interface Written {
  number: number
  text: string
}

interface Beside extends Written {
  from: number
  to: number
  insert: string
}

const TRIES = 3

function lineFound(doc: Text, wanted: Written): number | null {
  const same = (number: number) =>
    number >= 1 && number <= doc.lines && doc.line(number).text === wanted.text
  if (same(wanted.number)) return wanted.number

  for (let step = 1; step < doc.lines; step++) {
    if (same(wanted.number - step)) return wanted.number - step
    if (same(wanted.number + step)) return wanted.number + step
  }
  return null
}

function moved<T extends Written>(doc: Text, written: readonly T[]): T[] {
  return written.flatMap((one) => {
    const number = lineFound(doc, one)
    return number === null ? [] : [{ ...one, number }]
  })
}

function besides(doc: Text, also: readonly ChangeSpec[]): Beside[] {
  return also.flatMap((spec) => {
    if (!('from' in spec)) return []
    const line = doc.lineAt(spec.from)
    const insert = typeof spec.insert === 'string' ? spec.insert : (spec.insert?.toString() ?? '')
    return [
      {
        number: line.number,
        text: line.text,
        from: spec.from - line.from,
        to: (spec.to ?? spec.from) - line.from,
        insert,
      },
    ]
  })
}

export async function tickLines(
  view: EditorView,
  help: TaskHelp,
  before: Text,
  lines: readonly number[],
  also: readonly ChangeSpec[] = [],
): Promise<void> {
  let doc = before
  let ticked: Written[] = lines.map((number) => ({ number, text: before.line(number).text }))
  let beside = besides(before, also)

  for (let tried = 0; tried < TRIES; tried++) {
    if (!ticked.length && !beside.length) return

    const note = doc.toString()
    const edits: TextEdit[] = []
    const reached = new Set<number>()

    for (const { number } of ticked) {
      if (reached.has(number)) continue
      for (const edit of await help.tick(note, number - 1)) {
        edits.push(edit)
        const last = doc.lineAt(Math.min(edit.to, doc.length)).number
        for (let at = doc.lineAt(Math.min(edit.from, doc.length)).number; at <= last; at++) {
          reached.add(at)
        }
      }
    }

    if (view.state.doc !== doc) {
      doc = view.state.doc
      ticked = moved(doc, ticked)
      beside = moved(doc, beside)
      continue
    }

    if (!edits.length && !beside.length) return
    const changes = view.state.changes([
      ...beside.map((one) => {
        const from = doc.line(one.number).from
        return { from: from + one.from, to: from + one.to, insert: one.insert }
      }),
      ...edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
    ])
    view.dispatch({
      changes,
      selection: view.state.selection.map(changes, 1),
      userEvent: 'input',
    })
    return
  }
}
