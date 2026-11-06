import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { blockAt } from './block/span'

export const landed = StateEffect.define<number>()

const SEEN_FOR = 1400

const gone = StateEffect.define()

function markedAt(state: EditorState, pos: number): { from: number; to: number } | null {
  if (pos < 0 || pos > state.doc.length) return null

  const block = blockAt(state, pos)
  const line = state.doc.lineAt(pos)
  if (!block || block.kind === 'heading') return { from: line.from, to: line.to }

  return { from: block.from, to: block.to }
}

const marked = StateField.define<{ from: number; to: number } | null>({
  create: () => null,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(landed)) return markedAt(transaction.state, effect.value)
      if (effect.is(gone)) return null
    }

    if (!value || transaction.docChanged || transaction.selection) return null

    return value
  },

  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const held = state.field(field)
      if (!held) return Decoration.none

      const doc = state.doc
      const marks = []
      for (
        let number = doc.lineAt(held.from).number;
        number <= doc.lineAt(held.to).number;
        number++
      ) {
        marks.push(Decoration.line({ class: 'nib-landed' }).range(doc.line(number).from))
      }

      return Decoration.set(marks, true)
    }),
})

const forgetting = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined

    constructor(private readonly view: EditorView) {}

    update() {
      const held = this.view.state.field(marked, false) ?? null
      if (!held) {
        this.stop()
        return
      }
      if (this.timer !== undefined) return

      this.timer = setTimeout(() => {
        this.timer = undefined
        this.view.dispatch({ effects: gone.of(null) })
      }, SEEN_FOR)
    }

    stop() {
      clearTimeout(this.timer)
      this.timer = undefined
    }

    destroy() {
      this.stop()
    }
  },
)

export function landing(): Extension {
  return [marked, forgetting]
}
