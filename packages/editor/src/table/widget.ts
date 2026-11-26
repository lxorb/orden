import type { Extension } from '@codemirror/state'
import { type EditorView, ViewPlugin } from '@codemirror/view'
import { door } from '@orden/markdown/door'
import { OrdenWidget } from '../live-preview/widget'
import { drawStill, element, PASTE_TEXT } from './cells'
import { parseTable } from './model'
import { noteChanges, tablesKeptApart } from './navigation'
import type { TableMenu, TableView } from './view'

export const edited: { table: { flush(): void } | null } = { table: null }
export function flushTableEdits() {
  edited.table?.flush()
}
let Made: typeof TableView | null = null
const still = new Map<HTMLElement, { editor: EditorView; text: TableWidget }>()
export const loadTableView = door(() =>
  import('./view').then((module) => {
    Made = module.TableView
    for (const [dom, { editor, text }] of still) {
      if (editor.contentDOM.contains(dom)) raise(dom, editor, text, editor.posAtDOM(dom))
    }
    still.clear()
  }),
)
export function withTableView(run: () => void) {
  if (Made) run()
  else void loadTableView().then(run)
}
function raise(dom: HTMLElement, editor: EditorView, text: TableWidget, from: number) {
  const model = parseTable(text.source)
  if (!Made || !model) return
  const table = new Made(editor, { source: text.source, from, to: from + text.source.length }, model, dom)
  views.set(dom, table)
  live.add(table)
  drawnIn.set(table, showing.get(editor))
}
export function editableCellAt(view: EditorView, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const cell = target.closest('td, th')
  if (!(cell instanceof HTMLElement) || cell.contentEditable !== 'true') return null
  return view.contentDOM.contains(cell) ? cell : null
}
export function pasteIntoCell(cell: HTMLElement, text: string): void {
  cell.focus()
  cell.dispatchEvent(new CustomEvent(PASTE_TEXT, { detail: text }))
}
const views = new WeakMap<HTMLElement, TableView>()
const live = new Set<TableView>()
const showing = new WeakMap<EditorView, object>()
const drawnIn = new WeakMap<TableView, object | undefined>()
const tracking = ViewPlugin.define((view) => {
  showing.set(view, {})
  return {
    update(update) {
      if (update.docChanged) {
        noteChanges(update.view, update.changes)
        for (const table of live) if (table.editor === update.view) table.track(update.changes, update.state.doc)
      }
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        const { ranges } = update.state.selection
        for (const table of live) {
          if (table.editor !== update.view) continue
          const from = table.tracked
          table.covered(
            from !== null &&
              ranges.some((range) => !range.empty && range.from <= from && range.to >= from + table.length),
          )
        }
      }
    },
  }
})
export const tableTracking: Extension = [tracking, tablesKeptApart]
export function tableMenuAt(target: EventTarget | null): TableMenu | null {
  const wrap = target instanceof Element ? target.closest<HTMLElement>('.orden-table-wrap') : null
  return (wrap && views.get(wrap)?.menuAt(target)) ?? null
}
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
    return other.source === this.source && other.writable === this.writable
  }
  override ignoreEvent() {
    return true
  }
  toDOM(view: EditorView) {
    const model = parseTable(this.source)
    const wrap = element('div', 'orden-table-wrap')
    wrap.contentEditable = 'false'
    if (!model) wrap.textContent = this.source
    else if (Made) raise(wrap, view, this, this.from)
    else {
      drawStill(wrap, model)
      still.set(wrap, { editor: view, text: this })
      void loadTableView()
    }
    return wrap
  }
  override updateDOM(dom: HTMLElement, view: EditorView, previous: TableWidget) {
    const table = views.get(dom)
    if (!table) {
      const model = still.has(dom) ? parseTable(this.source) : null
      if (!model) return false
      drawStill(dom, model)
      still.set(dom, { editor: view, text: this })
      return true
    }
    const model = table.modelFor(this.source)
    if (!model) return false
    const moved = !table.continues(this) && previous.source !== this.source
    if (moved && !table.sameTable(model)) return false
    table.adopt(this, model)
    return true
  }
  override destroy(dom: HTMLElement) {
    still.delete(dom)
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
