import { redo, undo } from '@codemirror/commands'
import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { label, type LabelKey } from '../labels'
import { caretAtEdge, caretOffset, caretRect, selectAtPoint, selectIn, selectionIn, textRows } from './caret'
import { renderInline } from './inline'
import {
  type TableModel,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  removeColumn,
  removeRow,
  serializeTable,
  setAlign,
  setCell,
} from './model'
import {
  type CellAddress,
  type Side,
  cellAbove,
  cellAfter,
  cellBefore,
  cellBelow,
  firstCell,
  lastCell,
  lineBeside,
} from './navigation'
import { inlineShortcut, runInCell } from './shortcuts'

/** What a table's widget knows: the text it renders, and where that text is. */
export interface TableSource {
  source: string
  from: number
  to: number
}

/** Where the caret goes in a cell it has just been moved into: an end of the
 *  text, all of it, or the spot on the top or bottom row nearest to an x. */
export type Placement = 'start' | 'end' | 'all' | { x: number; edge: 'top' | 'bottom' }

/** Where the caret goes when it steps out: an end of the line, or the spot
 *  nearest to where it was. */
export type Landing = 'start' | 'end' | { x: number }

/** How long a cell may sit untouched before its edit is written out anyway.
 *  Blur is the primary trigger; this is the safety net for when focus never
 *  leaves the cell. */
const IDLE_COMMIT = 700

/** The table currently holding an uncommitted cell edit. Rewriting the source
 *  on every keystroke would be a document change per character, so edits
 *  land when the cell is left - or when this is flushed. */
let active: TableView | null = null

/** Writes any in-progress cell edit into the document. Call before saving. */
export function flushTableEdits() {
  active?.flush()
}

const ALIGN_PATHS = {
  left: 'M0 2h10M0 5h6M0 8h10',
  center: 'M0 2h10M2 5h6M0 8h10',
  right: 'M0 2h10M4 5h6M0 8h10',
} as const

const ALIGN_LABELS = {
  left: 'alignLeft',
  center: 'alignCenter',
  right: 'alignRight',
} as const

/** The live DOM of one rendered table. Built once and then kept up to date
 *  with the document, so that column widths, the caret and the controls
 *  survive each edit instead of being rebuilt around it. */
export class TableView {
  readonly dom: HTMLElement
  from: number
  to: number

  private readonly scroller: HTMLElement
  private readonly table: HTMLTableElement
  private readonly columnBar: HTMLElement
  private readonly alignButtons: Record<'left' | 'center' | 'right', HTMLButtonElement>

  private model: TableModel
  private source: string

  /** The focused cell's text, not yet in the document. */
  private pending: { at: CellAddress; value: string } | null = null
  private idle: number | undefined

  /** The cell to put the caret in once the next redraw has happened. */
  private focusAfter: { at: CellAddress; offset: number } | null = null

  /** Column widths set by dragging; markdown records none, so they are the
   *  view's to keep. */
  private widths: (number | null)[]

  /** The column whose controls are up. */
  private barColumn = -1

  constructor(
    readonly editor: EditorView,
    text: TableSource,
    model: TableModel,
  ) {
    this.model = model
    this.source = text.source
    this.from = text.from
    this.to = text.to
    this.widths = model.header.map(() => null)

    this.dom = element('div', 'nib-table-wrap')
    // Outside the editor's editable region: the cells opt back in one by one.
    // Without this the whole table is part of what CodeMirror believes is
    // document text, and the caret can be placed into DOM that maps to nothing.
    this.dom.contentEditable = 'false'

    this.scroller = element('div', 'nib-table-scroll')
    this.table = element('table', 'nib-table')
    this.scroller.append(this.table)

    this.alignButtons = {
      left: this.columnButton('left', ALIGN_PATHS.left, (column) => this.toggleAlign(column, 'left')),
      center: this.columnButton('center', ALIGN_PATHS.center, (column) =>
        this.toggleAlign(column, 'center'),
      ),
      right: this.columnButton('right', ALIGN_PATHS.right, (column) =>
        this.toggleAlign(column, 'right'),
      ),
    }
    this.columnBar = this.buildColumnBar()
    this.dom.append(this.scroller, this.columnBar)
    this.watchColumnHover()

    this.render()
  }

  /** Points the DOM at a newer version of the source. Redrawn only when the
   *  document says something the cells do not already show - after an edit
   *  made here, it never does. */
  adopt(text: TableSource, model: TableModel) {
    // Compared in canonical form: a table typed by hand is rarely aligned
    // the way the serializer writes it, and that is not a difference.
    const shown = serializeTable(model) === serializeTable(this.current())
    this.from = text.from
    this.to = text.to
    this.source = text.source
    this.model = model

    if (shown) {
      this.focusAfter = null
      return
    }
    this.clearPending()
    this.render()
  }

  destroy() {
    this.clearPending()
  }

  flush() {
    if (this.pending) this.commit(this.current())
  }

  /** Walks the caret in from the line above or below. */
  enter(side: Side, where: Landing): boolean {
    if (where === 'start') return this.focusCell(firstCell, 'start')
    if (where === 'end') return this.focusCell(lastCell(this.model), 'end')

    const row = side === 'above' ? -1 : this.model.rows.length - 1
    const column = this.columnAt(row, where.x)
    return this.focusCell({ row, column }, { x: where.x, edge: side === 'above' ? 'top' : 'bottom' })
  }

  /** Puts the caret in a cell. The cell swaps to its markdown as it takes
   *  focus, so the caret is placed after that, into the source text. */
  focusCell(at: CellAddress, placement: Placement | number): boolean {
    // The cell may be gone - an undo can take the column it was in - so the
    // nearest one that exists takes the caret instead.
    const { model } = this
    const cell = this.cellAt({
      row: Math.min(at.row, model.rows.length - 1),
      column: Math.min(at.column, model.header.length - 1),
    })
    if (!cell) return false

    cell.focus()
    const length = cell.textContent?.length ?? 0

    if (typeof placement === 'number') selectIn(cell, Math.min(placement, length))
    else if (placement === 'start') selectIn(cell, 0)
    else if (placement === 'end') selectIn(cell, length)
    else if (placement === 'all') selectIn(cell, 0, length)
    else {
      const rows = textRows(cell)
      const row = placement.edge === 'top' ? rows[0] : rows[rows.length - 1]
      if (!row) selectIn(cell, 0)
      else {
        const x = Math.max(row.left, Math.min(row.right - 1, placement.x))
        selectAtPoint(cell, x, (row.top + row.bottom) / 2)
      }
    }
    return true
  }

  /** Hands the caret back to the editor, on the line above or below. */
  leave(side: Side, where: Landing) {
    this.flush()

    const { editor } = this
    const line = lineBeside(editor.state, this, side)
    let pos = line.from
    if (!line.changes) {
      if (where === 'end') pos = line.to
      else if (typeof where === 'object') pos = posOnRow(editor, line, side, where.x)
    }

    // A vertical step out carries its column on, the way it does between
    // lines, so the next arrow press continues in the same column.
    const goal =
      typeof where === 'object' ? where.x - editor.contentDOM.getBoundingClientRect().left : undefined
    editor.dispatch({
      changes: line.changes,
      selection: EditorSelection.create([EditorSelection.cursor(pos, undefined, undefined, goal)]),
      scrollIntoView: true,
    })
    editor.focus()
  }

  /** The model including whatever the focused cell currently reads. */
  private current(): TableModel {
    const { pending, model } = this
    return pending ? setCell(model, pending.at.row, pending.at.column, pending.value) : model
  }

  /** Writes a model into the document. The new widget then adopts this DOM,
   *  which is where `focusAfter` is acted on. */
  private commit(next: TableModel, focus?: CellAddress) {
    window.clearTimeout(this.idle)
    this.focusAfter = focus ? { at: focus, offset: 0 } : null

    const text = serializeTable(next)
    // The document may have moved on without this table, in which case the
    // widget is about to be dropped and the edit with it. Better than writing
    // over whatever took its place.
    const { editor } = this
    const current = editor.state.doc.sliceString(this.from, this.to) === this.source

    if (text !== this.source && current) {
      // The edit stays pending through the dispatch: the new widget compares
      // the document against what the cells show, and the edit is part of it.
      editor.dispatch({ changes: { from: this.from, to: this.to, insert: text } })
    }

    this.clearPending()
    this.focusAfter = null
  }

  private clearPending() {
    window.clearTimeout(this.idle)
    this.pending = null
    if (active === this) active = null
  }

  private render() {
    const { model } = this
    // A redraw pulls the caret out of the cell it is in; note where it was.
    const focus = this.focusAfter ?? this.focusedCell()
    this.focusAfter = null

    const head = element('thead')
    const headRow = element('tr')
    head.append(headRow)

    model.header.forEach((text, column) => {
      const at = { row: -1, column }
      const th = this.cell(text, at, 'th', sameCell(at, focus?.at))

      // Markdown records no column widths, so a resize is a view-level nicety,
      // exactly as it is in Typora.
      const grip = element('span', 'nib-table-resize')
      grip.contentEditable = 'false'
      grip.title = label('dragToResize')
      grip.addEventListener('mousedown', (event) => this.startResize(event, th, column))
      th.append(grip)

      const width = this.widths[column]
      if (width != null) th.style.width = `${width}px`
      headRow.append(th)
    })

    const body = element('tbody')
    model.rows.forEach((row, index) => {
      const tr = element('tr')
      const cells = row.map((text, column) => {
        const at = { row: index, column }
        return this.cell(text, at, 'td', sameCell(at, focus?.at))
      })
      // A positioned <td> still reserves a table column, so the row controls
      // live in a div inside the first cell.
      cells[0]?.append(this.rowGrip(index))
      tr.append(...cells)
      body.append(tr)
    })

    this.table.replaceChildren(head, body)

    // The editor is still mid-update while it adopts the DOM; the caret goes
    // in once that has settled - unless the editor itself has taken it by
    // then, which means the caret was on its way out of the table.
    if (focus) {
      queueMicrotask(() => {
        if (document.activeElement === this.editor.contentDOM) return
        this.focusCell(focus.at, focus.offset)
      })
    }
  }

  private cell(text: string, at: CellAddress, tag: 'th' | 'td', editing: boolean) {
    const cell = element(tag)
    cell.contentEditable = 'true'
    cell.spellcheck = true
    cell.dataset.row = String(at.row)
    cell.dataset.column = String(at.column)

    // The cell is its own little source editor, so its text has to be the
    // markdown while the caret is in it. Everywhere else it shows the result,
    // which is the same bargain the rest of the editor makes with syntax. A
    // cell about to take the caret starts as source, so it does not flash.
    cell.dataset.source = text
    if (editing) showSource(cell)
    else showRendered(cell)

    const align = this.model.align[at.column]
    if (align) cell.style.textAlign = align

    // The browser places the caret from the click, but the text under the
    // click changes as the cell takes focus and shows its markdown. So the
    // caret is placed by hand, once the markdown is up.
    cell.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || document.activeElement === cell) return
      event.preventDefault()
      cell.focus()
      selectAtPoint(cell, event.clientX, event.clientY)
    })

    cell.addEventListener('focus', () => showSource(cell))
    cell.addEventListener('blur', () => this.left(cell, at))
    cell.addEventListener('input', () => this.edited(cell, at))
    cell.addEventListener('keydown', (event) => this.keyInCell(event, cell, at))
    cell.addEventListener('beforeinput', (event) => this.inputInCell(event, cell, at))
    cell.addEventListener('paste', (event) => this.pasteInCell(event, cell, at))

    return cell
  }

  private edited(cell: HTMLElement, at: CellAddress) {
    this.pending = { at, value: cell.textContent ?? '' }
    active = this

    window.clearTimeout(this.idle)
    this.idle = window.setTimeout(() => this.flush(), IDLE_COMMIT)
  }

  private left(cell: HTMLElement, at: CellAddress) {
    // A redraw blurs the old cell; its text is already in the document.
    if (!cell.isConnected) return
    this.flush()
    if (!cell.isConnected) return

    cell.dataset.source = this.textOf(at)
    showRendered(cell)
  }

  private keyInCell(event: KeyboardEvent, cell: HTMLElement, at: CellAddress) {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key

    if (key === 'Tab' && !mod && !event.altKey) {
      event.preventDefault()
      const next = event.shiftKey ? cellBefore(this.model, at) : cellAfter(this.model, at)
      if (next === 'below') this.growBelow(0)
      else if (next !== 'above') this.focusCell(next, event.shiftKey ? 'end' : 'start')
      return
    }

    // A cell holds one line, so no kind of Enter makes a new one inside it.
    if (key === 'Enter') {
      event.preventDefault()
      const next = cellBelow(this.model, at)
      if (next === 'below') this.growBelow(at.column)
      else this.focusCell(next, 'end')
      return
    }

    if (key === 'Escape') {
      event.preventDefault()
      this.leave('below', 'start')
      return
    }

    if (mod && !event.altKey) {
      const lower = key.toLowerCase()
      if (lower === 'z' && !event.shiftKey) return this.history(event, undo, cell, at)
      if (lower === 'y' || (lower === 'z' && event.shiftKey)) return this.history(event, redo, cell, at)
      // The browser's select-all reaches past the cell to the whole document.
      if (lower === 'a' && !event.shiftKey) {
        event.preventDefault()
        selectIn(cell, 0, cell.textContent?.length ?? 0)
        return
      }
    }

    const inline = inlineShortcut(event)
    if (inline) {
      event.preventDefault()
      this.runInline(inline, cell, at)
      return
    }

    if (mod || event.altKey || event.shiftKey) return

    switch (key) {
      case 'ArrowUp':
        if (!caretAtEdge(cell, 'top')) return
        event.preventDefault()
        return this.stepVertically(cellAbove(at), cell, 'above')
      case 'ArrowDown':
        if (!caretAtEdge(cell, 'bottom')) return
        event.preventDefault()
        return this.stepVertically(cellBelow(this.model, at), cell, 'below')
      case 'ArrowLeft': {
        if (!collapsedAt(cell, 0)) return
        event.preventDefault()
        const previous = cellBefore(this.model, at)
        if (previous === 'above') this.leave('above', 'end')
        else if (previous !== 'below') this.focusCell(previous, 'end')
        return
      }
      case 'ArrowRight': {
        if (!collapsedAt(cell, cell.textContent?.length ?? 0)) return
        event.preventDefault()
        const next = cellAfter(this.model, at)
        if (next === 'below') this.leave('below', 'start')
        else if (next !== 'above') this.focusCell(next, 'start')
        return
      }
    }
  }

  /** Up or down: into the cell in the same column, at the same x - or out of
   *  the table when there is no such cell. */
  private stepVertically(step: CellAddress | Side, cell: HTMLElement, side: Side) {
    const x = (caretRect() ?? cell.getBoundingClientRect()).left
    if (typeof step === 'string') this.leave(side, { x })
    else this.focusCell(step, { x, edge: side === 'above' ? 'bottom' : 'top' })
  }

  private growBelow(column: number) {
    const rows = this.model.rows.length
    this.commit(insertRow(this.current(), rows), { row: rows, column })
  }

  /** Undo and redo are the editor's, not the browser's: a cell's edits live
   *  in the document. The caret stays in the cell through the redraw. */
  private history(event: Event, command: StateCommand, cell: HTMLElement, at: CellAddress) {
    event.preventDefault()
    this.flush()
    this.focusAfter = { at, offset: caretOffset(cell) }
    command(this.editor)
    this.focusAfter = null
  }

  private runInline(command: StateCommand, cell: HTMLElement, at: CellAddress) {
    const selection = selectionIn(cell)
    if (!selection) return

    const result = runInCell(command, cell.textContent ?? '', selection.from, selection.to)
    if (!result) return

    cell.textContent = result.text
    selectIn(cell, result.from, result.to)
    this.edited(cell, at)
  }

  private inputInCell(event: InputEvent, cell: HTMLElement, at: CellAddress) {
    const type = event.inputType
    // The browser's own formatting would put HTML in the cell, and its line
    // breaks would split the row.
    if (type.startsWith('format') || type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault()
    } else if (type === 'historyUndo') {
      this.history(event, undo, cell, at)
    } else if (type === 'historyRedo') {
      this.history(event, redo, cell, at)
    }
  }

  private pasteInCell(event: ClipboardEvent, cell: HTMLElement, at: CellAddress) {
    event.preventDefault()
    const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r?\n/g, ' ')
    if (!text) return

    // Goes through the browser's editing so it fires `input` like typing.
    if (document.execCommand('insertText', false, text)) return

    const selection = selectionIn(cell)
    if (!selection) return
    const before = cell.textContent ?? ''
    cell.textContent = before.slice(0, selection.from) + text + before.slice(selection.to)
    selectIn(cell, selection.from + text.length)
    this.edited(cell, at)
  }

  private toggleAlign(column: number, align: 'left' | 'center' | 'right') {
    const base = this.current()
    const next = setAlign(base, column, align === base.align[column] ? null : align)
    this.commit(next, this.focusedCell()?.at)
  }

  private moveColumnBy(column: number, step: number) {
    const base = this.current()
    const next = moveColumn(base, column, column + step)
    if (next === base) return

    const [width] = this.widths.splice(column, 1)
    this.widths.splice(column + step, 0, width ?? null)

    const focused = this.focusedCell()?.at
    this.commit(next, focused && { row: focused.row, column: column + step })
  }

  private insertColumnAfter(column: number) {
    this.widths.splice(column + 1, 0, null)
    this.commit(insertColumn(this.current(), column + 1), { row: -1, column: column + 1 })
  }

  private deleteColumn(column: number) {
    const base = this.current()
    const next = removeColumn(base, column)
    if (next === base) return

    this.widths.splice(column, 1)
    const focused = this.focusedCell()?.at
    const kept = Math.min(column, next.header.length - 1)
    this.commit(next, focused && { row: focused.row, column: kept })
  }

  private moveRowBy(row: number, step: number) {
    const base = this.current()
    const next = moveRow(base, row, row + step)
    if (next === base) return

    const focused = this.focusedCell()?.at
    this.commit(next, focused && { row: row + step, column: focused.column })
  }

  private insertRowAfter(row: number) {
    this.commit(insertRow(this.current(), row + 1), { row: row + 1, column: 0 })
  }

  private deleteRow(row: number) {
    const next = removeRow(this.current(), row)
    const focused = this.focusedCell()?.at
    const kept = Math.min(row, next.rows.length - 1)
    this.commit(next, focused && { row: kept, column: focused.column })
  }

  private rowGrip(row: number): HTMLElement {
    const grip = element('div', 'nib-table-grip')
    grip.contentEditable = 'false'
    grip.append(
      button('nib-table-btn', 'moveRowUp', 'M1 6l4-4 4 4', () => this.moveRowBy(row, -1)),
      button('nib-table-btn', 'moveRowDown', 'M1 4l4 4 4-4', () => this.moveRowBy(row, 1)),
      button('nib-table-btn', 'insertRow', 'M5 1v8M1 5h8', () => this.insertRowAfter(row)),
      button('nib-table-btn nib-table-btn-danger', 'deleteRow', 'M1 1l8 8M9 1l-8 8', () =>
        this.deleteRow(row),
      ),
    )
    return grip
  }

  /** One set of column controls for the whole table, shown over whichever
   *  header cell is hovered or holds the caret. Kept outside the scrolling
   *  part so it can hang above the table without the table making room. */
  private buildColumnBar(): HTMLElement {
    const bar = element('div', 'nib-table-columns')
    bar.contentEditable = 'false'
    bar.append(
      this.alignButtons.left,
      this.alignButtons.center,
      this.alignButtons.right,
      this.columnButton('moveColumnLeft', 'M6 1L2 5l4 4', (column) => this.moveColumnBy(column, -1)),
      this.columnButton('moveColumnRight', 'M4 1l4 4-4 4', (column) => this.moveColumnBy(column, 1)),
      this.columnButton('insertColumn', 'M5 1v8M1 5h8', (column) => this.insertColumnAfter(column)),
      this.columnButton('deleteColumn', 'M1 1l8 8M9 1l-8 8', (column) => this.deleteColumn(column), true),
    )
    return bar
  }

  private columnButton(
    name: LabelKey | 'left' | 'center' | 'right',
    path: string,
    onPress: (column: number) => void,
    danger = false,
  ): HTMLButtonElement {
    const key = name in ALIGN_LABELS ? ALIGN_LABELS[name as keyof typeof ALIGN_LABELS] : (name as LabelKey)
    const className = danger ? 'nib-table-btn nib-table-btn-danger' : 'nib-table-btn'
    return button(className, key, path, () => onPress(this.barColumn))
  }

  private watchColumnHover() {
    this.dom.addEventListener('mouseover', (event) => {
      const target = event.target as Element
      const th = target.closest('th')
      if (th && this.table.contains(th)) this.showColumnBar(th)
      else if (!this.columnBar.contains(target)) this.hideColumnBar()
    })
    this.dom.addEventListener('mouseleave', () => this.hideColumnBar())

    this.table.addEventListener('focusin', (event) => {
      const th = (event.target as Element).closest('th')
      if (th) this.showColumnBar(th)
    })
    this.table.addEventListener('focusout', (event) => {
      const next = (event.relatedTarget as Element | null)?.closest('th')
      if (next && this.table.contains(next)) this.showColumnBar(next)
      else this.hideColumnBar()
    })

    // The bar sits outside the scrolling part, so it has to follow by hand.
    this.scroller.addEventListener('scroll', () => {
      const th = this.headerCell(this.barColumn)
      if (th && this.columnBar.classList.contains('is-shown')) this.showColumnBar(th)
    })
  }

  private showColumnBar(th: HTMLTableCellElement) {
    const column = Number(th.dataset.column)
    this.barColumn = column

    const bar = this.columnBar
    bar.classList.add('is-shown')
    const wrap = this.dom.getBoundingClientRect()
    const cell = th.getBoundingClientRect()
    const left = Math.max(0, Math.min(cell.left - wrap.left, wrap.width - bar.offsetWidth))
    bar.style.left = `${left}px`

    const align = this.model.align[column]
    for (const [name, element] of Object.entries(this.alignButtons)) {
      element.classList.toggle('is-active', name === align)
    }
  }

  /** Unless a header cell holds the caret: its controls stay reachable. */
  private hideColumnBar() {
    const focused = document.activeElement?.closest('th')
    if (focused && this.table.contains(focused)) this.showColumnBar(focused)
    else this.columnBar.classList.remove('is-shown')
  }

  /** Drags the boundary between two columns. Width lives on the header cell,
   *  and the rest of the column follows because the table is laid out from it. */
  private startResize(event: MouseEvent, header: HTMLTableCellElement, column: number) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = header.getBoundingClientRect().width

    const move = (moved: MouseEvent) => {
      const width = Math.max(48, startWidth + (moved.clientX - startX))
      this.widths[column] = width
      header.style.width = `${width}px`
    }
    const finish = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', finish)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', finish)
  }

  private cellAt(at: CellAddress): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(`[data-row="${at.row}"][data-column="${at.column}"]`)
  }

  private headerCell(column: number): HTMLTableCellElement | null {
    return this.table.querySelector<HTMLTableCellElement>(`th[data-column="${column}"]`)
  }

  private focusedCell(): { at: CellAddress; offset: number } | null {
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement) || !this.table.contains(focused)) return null
    if (focused.dataset.row === undefined) return null

    return {
      at: { row: Number(focused.dataset.row), column: Number(focused.dataset.column) },
      offset: caretOffset(focused),
    }
  }

  /** The column under an x coordinate, in a given row; the nearest one past
   *  the table's edges. */
  private columnAt(row: number, x: number): number {
    const columns = this.model.header.length
    for (let column = 0; column < columns; column++) {
      const cell = this.cellAt({ row, column })
      if (cell && x < cell.getBoundingClientRect().right) return column
    }
    return columns - 1
  }

  private textOf(at: CellAddress): string {
    const { model } = this
    return (at.row < 0 ? model.header[at.column] : model.rows[at.row]?.[at.column]) ?? ''
  }
}

/** The position on a line nearest to an x coordinate: on its last visual row
 *  when arriving from below, its first when arriving from above. */
function posOnRow(view: EditorView, line: { from: number; to: number }, side: Side, x: number) {
  const anchor = side === 'above' ? view.coordsAtPos(line.to, -1) : view.coordsAtPos(line.from, 1)
  if (!anchor) return side === 'above' ? line.to : line.from

  const pos = view.posAtCoords({ x, y: (anchor.top + anchor.bottom) / 2 })
  return pos === null ? line.from : Math.max(line.from, Math.min(line.to, pos))
}

/** What the cell says when it is not being edited. */
function showRendered(cell: HTMLElement) {
  cell.replaceChildren(renderInline(cell.dataset.source ?? ''))
}

/** What it says when it is. An empty text node rather than nothing, so there
 *  is somewhere for the caret to sit in an empty cell. */
function showSource(cell: HTMLElement) {
  cell.replaceChildren(document.createTextNode(cell.dataset.source ?? ''))
}

/** Whether the caret, and nothing selected, sits at an offset in a cell. */
function collapsedAt(cell: HTMLElement, offset: number): boolean {
  const selection = selectionIn(cell)
  return selection !== null && selection.from === offset && selection.to === offset
}

function sameCell(a: CellAddress, b: CellAddress | undefined): boolean {
  return b !== undefined && a.row === b.row && a.column === b.column
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 10 10')
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('d', path)
  svg.append(shape)
  return svg
}

function button(className: string, key: LabelKey, path: string, onPress: () => void) {
  const node = document.createElement('button')
  node.className = className
  node.type = 'button'
  node.title = label(key)
  node.setAttribute('aria-label', label(key))
  node.append(icon(path))
  // On mousedown, and with the default stopped, so the caret stays in
  // whichever cell holds it while the button acts.
  node.addEventListener('mousedown', (event) => {
    event.preventDefault()
    onPress()
  })
  return node
}
