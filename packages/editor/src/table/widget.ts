import type { EditorView } from '@codemirror/view'
import { NibWidget } from '../live-preview/widget'
import { parseTable } from './model'
import { TableView } from './view'

export { flushTableEdits } from './view'

/** The live table behind each widget's DOM, and the ones on screen. */
const views = new WeakMap<HTMLElement, TableView>()
const live = new Set<TableView>()

/** The rendered table whose source starts at a position, if it is on screen. */
export function tableViewAt(editor: EditorView, from: number): TableView | null {
  for (const table of live) {
    if (table.editor === editor && table.span()?.from === from) return table
  }
  return null
}

export class TableWidget extends NibWidget {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly to: number,
    /** Whether the note takes edits. A table drawn for a reader has no fields
     *  in it, so this is part of what makes two widgets the same table: the
     *  cells are contenteditable in the DOM, and only a redraw undoes that. */
    readonly writable = true,
  ) {
    super()
  }

  override eq(other: TableWidget) {
    return (
      other.source === this.source && other.from === this.from && other.writable === this.writable
    )
  }

  /** The widget runs its own editing, so CodeMirror should not interpret events. */
  override ignoreEvent() {
    return true
  }

  toDOM(view: EditorView) {
    const model = parseTable(this.source)
    if (!model) {
      const wrap = document.createElement('div')
      wrap.className = 'nib-table-wrap'
      wrap.contentEditable = 'false'
      wrap.textContent = this.source
      return wrap
    }

    const table = new TableView(view, this, model)
    views.set(table.dom, table)
    live.add(table)
    return table.dom
  }

  /** A table that was edited, moved or undone keeps its DOM. Cells the
   *  document disagrees with are redrawn; column widths and the caret stay. */
  override updateDOM(dom: HTMLElement, _view: EditorView, previous: TableWidget) {
    const table = views.get(dom)
    if (!table) return false
    if (previous.from !== this.from && previous.source !== this.source) return false

    const model = parseTable(this.source)
    if (!model) return false

    table.adopt(this, model)
    return true
  }

  override destroy(dom: HTMLElement) {
    const table = views.get(dom)
    if (table) {
      table.destroy()
      views.delete(dom)
      live.delete(table)
    }
    super.destroy(dom)
  }
}
