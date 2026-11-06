import type { ChangeSpec, Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { TextEdit } from '@orden/markdown/edits'
import type { TaskHelp } from './wikilink/notes'

export async function tickLines(
  view: EditorView,
  help: TaskHelp,
  before: Text,
  lines: readonly number[],
  also: readonly ChangeSpec[] = [],
): Promise<void> {
  const note = before.toString()
  const edits: TextEdit[] = []

  for (const number of lines) {
    const line = before.line(number)
    const reached = edits.some((edit) => edit.from <= line.to && edit.to >= line.from)
    if (reached) continue
    edits.push(...(await help.tick(note, number - 1)))
  }

  if (view.state.doc !== before || (!edits.length && !also.length)) return
  const changes = view.state.changes([
    ...also,
    ...edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
  ])
  view.dispatch({
    changes,
    selection: view.state.selection.map(changes, 1),
    userEvent: 'input',
  })
}
