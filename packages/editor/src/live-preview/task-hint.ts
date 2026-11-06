import { type EditorState, StateField, type Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { taskAt } from '@orden/markdown/tasks'
import { type DayTyped, noteIndex } from '../wikilink/notes'
import { NibWidget } from './widget'

interface Hint {
  day: DayTyped
  from: number
  to: number
}

const DATED = /[📅📆🗓⏳⌛]|\[(?:due|scheduled|time)::/u

function hintAt(state: EditorState): Hint | null {
  const help = state.facet(noteIndex).tasks
  const { main } = state.selection
  if (!help || !main.empty || state.selection.ranges.length > 1) return null

  const line = state.doc.lineAt(main.head)
  const task = taskAt(line.text)
  if (!task || task.done || task.mark === '-' || DATED.test(line.text)) return null
  if (main.head - line.from !== line.text.trimEnd().length) return null

  const words = line.text.slice(task.marker, main.head - line.from)
  const day = help.dayAtEnd(words)
  if (!day || day.from <= 0) return null
  return { day, from: line.from + task.marker + day.from, to: main.head }
}

class HintWidget extends NibWidget {
  constructor(private readonly text: string) {
    super()
  }

  override eq(other: HintWidget) {
    return other.text === this.text
  }

  toDOM() {
    const hint = document.createElement('span')
    hint.className = 'nib-task-hint'
    hint.textContent = `🛫 ${this.text} ⇥`
    return hint
  }
}

const hinted = StateField.define<Hint | null>({
  create: hintAt,
  update: (value, transaction: Transaction) =>
    transaction.docChanged || transaction.selection ? hintAt(transaction.state) : value,
  provide: (field) =>
    EditorView.decorations.from(field, (hint): DecorationSet => {
      if (!hint) return Decoration.none
      const widget = new HintWidget(hint.day.label)
      return Decoration.set([Decoration.widget({ widget, side: 1 }).range(hint.to)])
    }),
})

async function write(view: EditorView, hint: Hint) {
  const [{ appliedEdits, oneEdit }, { writeTask }, { readTask }, { startField }] =
    await Promise.all([
      import('@orden/markdown/edits'),
      import('@orden/markdown/task-edits'),
      import('@orden/markdown/task-line'),
      import('@orden/markdown/task-dates'),
    ])
  if (view.state.field(hinted, false) !== hint) return

  const line = view.state.doc.lineAt(hint.to)
  let start = hint.from - line.from
  while (start > 0 && /[ \t]/.test(line.text.charAt(start - 1))) start--
  const without = line.text.slice(0, start) + line.text.slice(hint.to - line.from)
  const { due, time } = hint.day
  const field = startField(readTask(without) ?? {}, view.state.facet(noteIndex).dueReads ?? 'start')
  const after = appliedEdits(
    without,
    writeTask(without, time === undefined ? { [field]: due } : { [field]: due, time }),
  )
  const edit = oneEdit(line.text, after)
  if (!edit) return
  view.dispatch({
    changes: { from: line.from + edit.from, to: line.from + edit.to, insert: edit.insert },
    selection: { anchor: line.from + start },
    userEvent: 'input',
  })
}

export function takeHint(view: EditorView): boolean {
  const hint = view.state.field(hinted, false)
  if (!hint) return false
  void write(view, hint)
  return true
}

export const taskHint = hinted
