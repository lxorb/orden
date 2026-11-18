import { type EditorView, ViewPlugin } from '@codemirror/view'
import { OrdenWidget } from '../live-preview/widget'
import { parseTable } from './model'
import { noteChanges } from './navigation'
import { TableView } from './view'

export { flushTableEdits } from './view'

const views = new WeakMap<HTMLElement, TableView>()
const live = new Set<TableView>()
const showing = new WeakMap<EditorView, object>()
const drawnIn = new WeakMap<TableView, object | undefined>()

export const tableTracking = ViewPlugin.define((view) => {
  showing.set(view, {})
  return {
    update(update) {
      if (!update.docChanged) return
      noteChanges(update.view, update.changes)
      for (const table of live)
        if (table.editor === update.view) table.track(update.changes, update.state.doc)
    },
  }
})

export function tableViewAt(editor: EditorView, from: number): TableView | null {
  for (const table of live) if (table.editor === editor && table.span()?.from === from) return table
  return null
}

export class TableWidget extends OrdenWidget {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly to: number,
    readonly writable = true,
  ) {
    super()
  }

  override eq(other: TableWidget) {
    return (
      other.source === this.source && other.from === this.from && other.writable === this.writable
    )
  }

  override ignoreEvent() {
    return true
  }

  toDOM(view: EditorView) {
    const model = parseTable(this.source)
    if (!model) {
      const wrap = document.createElement('div')
      wrap.className = 'orden-table-wrap'
      wrap.contentEditable = 'false'
      wrap.textContent = this.source
      return wrap
    }

    const table = new TableView(view, this, model)
    views.set(table.dom, table)
    live.add(table)
    drawnIn.set(table, showing.get(view))
    return table.dom
  }

  override updateDOM(dom: HTMLElement, _view: EditorView, previous: TableWidget) {
    const table = views.get(dom)
    if (!table) return false

    const model = table.modelFor(this.source)
    if (!model) return false

    const moved = previous.from !== this.from && previous.source !== this.source
    if (moved && !(table.continues(this) && table.sameTable(model))) return false

    table.adopt(this, model)
    return true
  }

  override destroy(dom: HTMLElement) {
    const table = views.get(dom)
    if (table) {
      const focus = table.focusState()
      const start = table.tracked
      const shown = drawnIn.get(table)
      const { editor } = table
      if (focus) {
        queueMicrotask(() => {
          if (showing.get(editor) !== shown) return
          const drawn = start === null ? null : tableViewAt(editor, start)
          if (drawn) drawn.focusCell(focus.at, focus.offset)
          else if (editor.dom.isConnected && !editor.dom.contains(document.activeElement)) {
            editor.focus()
          }
        })
      }
      table.destroy()
      views.delete(dom)
      live.delete(table)
    }
    super.destroy(dom)
  }
}
