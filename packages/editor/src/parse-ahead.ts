import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

const BUDGET = 25

const AS_BUILT = 60

const drawnThrough = (view: EditorView) => syntaxTree(view.state).length >= view.viewport.to

class ParseAhead {
  private gone = false

  constructor(view: EditorView) {
    ensureSyntaxTree(view.state, view.state.doc.length, AS_BUILT)
    this.check(view)
  }

  update(update: ViewUpdate) {
    if (update.viewportChanged || update.docChanged) this.check(update.view)
  }

  destroy() {
    this.gone = true
  }

  private check(view: EditorView) {
    if (this.gone || drawnThrough(view)) return

    view.requestMeasure({
      key: this,
      read: () => null,
      write: () => {
        if (drawnThrough(view)) return

        const tree = ensureSyntaxTree(view.state, view.viewport.to, BUDGET)
        if (!tree) {
          requestAnimationFrame(() => this.check(view))
          return
        }
        if (tree === syntaxTree(view.state)) return
        queueMicrotask(() => {
          if (!this.gone) view.dispatch({})
        })
      },
    })
  }
}

export const parseAhead = ViewPlugin.fromClass(ParseAhead)

export function parsedOnScreen(view: EditorView): boolean {
  return drawnThrough(view)
}
