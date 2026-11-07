import type { EditorView } from '@codemirror/view'
import { NibWidget } from '../live-preview/widget'
import { parseTable } from './model'
import { TableView } from './view'

export { flushTableEdits } from './view'

const views = new WeakMap<HTMLElement, TableView>()
const live = new Set<TableView>()

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
    return table.dom
  }

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
