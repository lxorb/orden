import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { label, type LabelKey } from '../labels'
import { redoEdit, undoEdit } from '../shared'
import {
  attached,
  button,
  collapsedAt,
  element,
  posOnRow,
  sameCell,
  showRendered,
  showSource,
} from './cells'
import {
  caretAtEdge,
  caretOffset,
  caretRect,
  selectAtPoint,
  selectIn,
  selectionIn,
  textRows,
} from './caret'
import { type Align, type Order, type TableModel, serializeTable, setCell } from './model'
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
  type TableSpan,
  tableAt,
} from './navigation'
import {
  alignedColumn,
  type Edit,
  type Focus,
  insertedColumn,
  insertedRow,
  movedColumn,
  movedRow,
  removedColumn,
  removedRow,
  sortedColumn,
} from './edits'
import { inlineShortcut, runInCell } from './shortcuts'

export interface TableSource {
  source: string
  from: number
  to: number
}

export type Placement = 'start' | 'end' | 'all' | { x: number; edge: 'top' | 'bottom' }

export type Landing = 'start' | 'end' | { x: number }

const IDLE_COMMIT = 700

const WINDOWED = 150

const AROUND = 40

const STEP = 20

const GUESSED_ROW = 32

let active: TableView | null = null

export function flushTableEdits() {
  active?.flush()
}

function holdsEdit(table: TableView) {
  active = table
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

export class TableView {
  readonly dom: HTMLElement

  private readonly scroller: HTMLElement
  private readonly table: HTMLTableElement
  private readonly columnBar: HTMLElement
  private readonly rowBar: HTMLElement
  private readonly alignButtons: Record<'left' | 'center' | 'right', HTMLButtonElement>

  private model: TableModel
  private source: string
  private from: number

  private pending: { at: CellAddress; value: string } | null = null
  private idle: number | undefined

  private focusAfter: Focus | null = null

  private widths: (number | null)[]

  private barColumn = -1

  private barRow = -1

  private sortedAs: { column: number; order: Order } | null = null

  private dragging: (() => void) | null = null

  private editable: boolean

  private body: HTMLTableSectionElement | null = null

  private readonly drawn = new Map<number, HTMLTableRowElement>()

  private readonly heights = new Map<number, number>()

  private shown = { from: 0, to: 0 }

  private guess = GUESSED_ROW

  private drawnFor = -1

  private fitted: number[] | null = null

  private frame = 0

  private gaps: IntersectionObserver | null = null

  private following = false

  constructor(
    readonly editor: EditorView,
    text: TableSource,
    model: TableModel,
  ) {
    this.model = model
    this.source = text.source
    this.from = text.from
    this.widths = model.header.map(() => null)
    this.editable = !editor.state.readOnly

    this.dom = element('div', 'nib-table-wrap')
    this.dom.contentEditable = 'false'

    this.scroller = element('div', 'nib-table-scroll')
    this.table = element('table', 'nib-table')
    this.scroller.append(this.table)

    this.alignButtons = {
      left: this.columnButton('left', ALIGN_PATHS.left, (column) =>
        this.toggleAlign(column, 'left'),
      ),
      center: this.columnButton('center', ALIGN_PATHS.center, (column) =>
        this.toggleAlign(column, 'center'),
      ),
      right: this.columnButton('right', ALIGN_PATHS.right, (column) =>
        this.toggleAlign(column, 'right'),
      ),
    }
    this.columnBar = this.buildColumnBar()
    this.rowBar = this.buildRowBar()
    this.dom.append(this.scroller, this.columnBar, this.rowBar)
    this.watchColumnHover()
    this.watchRowHover()

    this.render()
  }

  span(): TableSpan | null {
    const { editor, dom } = this
    if (!editor.contentDOM.contains(dom)) return null

    const at = Math.min(editor.posAtDOM(dom), editor.state.doc.length)
    return tableAt(editor.state, editor.state.doc.lineAt(at).to)
  }

  adopt(text: TableSource, model: TableModel) {
    const shown = serializeTable(model) === serializeTable(this.current())
    this.source = text.source
    this.from = text.from
    this.model = model

    if (shown && this.editable === !this.editor.state.readOnly) {
      this.focusAfter = null
      return
    }
    this.editable = !this.editor.state.readOnly
    this.clearPending()
    this.render()
  }

  destroy() {
    const left = this.pending ? serializeTable(this.current()) : null
    const { editor, from, source } = this
    this.clearPending()
    this.dragging?.()
    this.unfollow()
    if (left !== null && left !== source) queueMicrotask(() => keepEdit(editor, from, source, left))
  }

  flush() {
    if (this.pending) this.commit(this.current())
  }

  enter(side: Side, where: Landing): boolean {
    if (where === 'start') return this.focusCell(firstCell, 'start')
    if (where === 'end') return this.focusCell(lastCell(this.model), 'end')

    const row = side === 'above' ? -1 : this.model.rows.length - 1
    const column = this.columnAt(row, where.x)
    return this.focusCell(
      { row, column },
      { x: where.x, edge: side === 'above' ? 'top' : 'bottom' },
    )
  }

  focusCell(at: CellAddress, placement: Placement | number): boolean {
    if (this.editor.state.readOnly) return false

    const { model } = this
    const row = Math.min(at.row, model.rows.length - 1)
    this.reach(row)
    const cell = this.cellAt({ row, column: Math.min(at.column, model.header.length - 1) })
    if (!cell) return false

    cell.focus()
    const length = cell.textContent.length

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

  leave(side: Side, where: Landing) {
    this.flush()

    const { editor } = this
    const span = this.span()
    if (!span) return

    const line = lineBeside(editor.state, span, side)
    let pos = line.from
    if (!line.made) {
      if (where === 'end') pos = line.to
      else if (typeof where === 'object') pos = posOnRow(editor, line, side, where.x)
    }

    const goal =
      typeof where === 'object'
        ? where.x - editor.contentDOM.getBoundingClientRect().left
        : undefined
    editor.dispatch({
      changes: line.changes,
      selection: EditorSelection.create([EditorSelection.cursor(pos, undefined, undefined, goal)]),
      scrollIntoView: true,
    })
    editor.focus()
  }

  private current(): TableModel {
    const { pending, model } = this
    return pending ? setCell(model, pending.at.row, pending.at.column, pending.value) : model
  }

  private commit(next: TableModel, focus?: Focus) {
    if (this.editor.state.readOnly) {
      this.clearPending()
      return
    }

    window.clearTimeout(this.idle)
    this.focusAfter = focus ?? null

    const text = serializeTable(next)
    const { editor } = this
    const span = this.span()
    const current = span && editor.state.doc.sliceString(span.from, span.to) === this.source

    if (text !== this.source && span && current) {
      editor.dispatch({ changes: { from: span.from, to: span.to, insert: text } })
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
    const focus = this.focusAfter ?? this.focusedCell()
    this.focusAfter = null
    const windowed = this.windowed()

    const head = element('thead')
    const headRow = element('tr')
    head.append(headRow)

    if (this.fitted?.length !== model.header.length) this.fitted = null
    model.header.forEach((text, column) => {
      const at = { row: -1, column }
      const th = this.cell(text, at, 'th', sameCell(at, focus?.at))

      const grip = element('span', 'nib-table-resize')
      grip.contentEditable = 'false'
      grip.title = label('dragToResize')
      grip.addEventListener('mousedown', (event) => this.startResize(event, th, column))
      th.append(grip)

      const width = this.widths[column] ?? (windowed ? this.fitted?.[column] : undefined)
      if (width != null) th.style.width = `${width}px`
      headRow.append(th)
    })

    const rows = model.rows.length
    if (rows !== this.drawnFor) this.heights.clear()
    this.drawnFor = rows
    this.body = element('tbody')
    this.drawn.clear()
    if (!windowed) this.shown = { from: 0, to: rows }
    else if (focus && focus.at.row >= 0) this.shown = around(focus.at.row, rows)
    else if (this.shown.from >= rows || this.shown.to - this.shown.from < 2 * AROUND)
      this.shown = { from: 0, to: Math.min(rows, 2 * AROUND) }
    else this.shown = { from: this.shown.from, to: Math.min(rows, this.shown.to) }
    this.fill(focus?.at)

    this.table.replaceChildren(head, this.body)
    this.fitWidth()

    if (this.rowBar.classList.contains('is-shown')) {
      const tr = this.bodyRow(this.barRow)
      if (tr) this.showRowBar(tr)
      else this.hideRowBar()
    }

    if (windowed) this.follow()
    else this.unfollow()

    if (focus) {
      queueMicrotask(() => {
        if (document.activeElement === this.editor.contentDOM) return
        this.focusCell(focus.at, focus.offset)
      })
    }
  }

  private fitWidth() {
    const { fitted } = this
    const fixed = this.windowed() && fitted !== null
    this.table.classList.toggle('nib-table-windowed', fixed)
    this.table.style.width = fixed
      ? `${fitted.reduce((sum, one, column) => sum + (this.widths[column] ?? one), 0)}px`
      : ''
  }

  private fit() {
    const heads = [...this.table.querySelectorAll<HTMLElement>('thead th')]
    const widths = heads.map((th) => th.getBoundingClientRect().width)
    if (!widths.length || widths.some((one) => one <= 0)) return

    this.fitted = widths
    heads.forEach((th, column) => {
      th.style.width = `${this.widths[column] ?? widths[column]}px`
    })
    this.fitWidth()
  }

  private windowed(): boolean {
    return this.model.rows.length > WINDOWED
  }

  private row(index: number, editing?: CellAddress): HTMLTableRowElement {
    const held = this.drawn.get(index)
    if (held) return held

    const tr = element('tr')
    tr.dataset.row = String(index)
    const cells = (this.model.rows[index] ?? []).map((text, column) => {
      const at = { row: index, column }
      return this.cell(text, at, 'td', sameCell(at, editing))
    })
    tr.append(...cells)
    this.drawn.set(index, tr)
    return tr
  }

  private gap(from: number, to: number): HTMLTableRowElement {
    const tr = element('tr', 'nib-table-gap')
    tr.setAttribute('aria-hidden', 'true')
    const td = element('td')
    td.colSpan = Math.max(1, this.model.header.length)
    let height = 0
    for (let row = from; row < to; row++) height += this.heights.get(row) ?? this.guess
    td.style.height = `${height}px`
    tr.append(td)
    return tr
  }

  private fill(editing?: CellAddress) {
    const { body } = this
    if (!body) return

    const rows = this.model.rows.length
    const { from, to } = this.shown
    const kept = this.focusedCell()?.at.row ?? -1
    const spans: [number, number][] = [[from, to]]
    if (kept >= 0 && kept < rows && (kept < from || kept >= to)) {
      spans.push([kept, kept + 1])
      spans.sort((one, other) => one[0] - other[0])
    }

    const wanted: HTMLTableRowElement[] = []
    const showing = new Set<number>()
    let at = 0
    for (const [start, end] of spans) {
      if (start > at) wanted.push(this.gap(at, start))
      for (let index = start; index < end; index++) {
        wanted.push(this.row(index, editing))
        showing.add(index)
      }
      at = end
    }
    if (at < rows) wanted.push(this.gap(at, rows))

    for (const index of this.drawn.keys()) if (!showing.has(index)) this.drawn.delete(index)

    const held = kept >= 0 ? this.drawn.get(kept) : undefined
    for (const child of [...body.children]) if (child !== held) child.remove()
    if (!held?.isConnected) body.append(...wanted)
    else {
      const place = wanted.indexOf(held)
      held.before(...wanted.slice(0, place))
      held.after(...wanted.slice(place + 1))
    }

    if (this.gaps) {
      this.gaps.disconnect()
      for (const one of wanted) if (one.classList.contains('nib-table-gap')) this.gaps.observe(one)
    }
  }

  private reach(row: number) {
    if (!this.windowed() || row < 0 || this.drawn.has(row)) return
    this.shown = around(row, this.model.rows.length)
    this.fill()
  }

  private follow() {
    if (this.following) {
      this.schedule()
      return
    }
    this.following = true
    document.addEventListener('scroll', this.schedule, { capture: true, passive: true })
    window.addEventListener('resize', this.schedule, { passive: true })
    if (typeof IntersectionObserver !== 'undefined') {
      this.gaps = new IntersectionObserver(this.schedule, { rootMargin: '50%' })
      for (const one of this.body?.querySelectorAll('.nib-table-gap') ?? []) this.gaps.observe(one)
    }
    this.schedule()
  }

  private unfollow() {
    if (!this.following) return
    this.following = false
    document.removeEventListener('scroll', this.schedule, { capture: true })
    window.removeEventListener('resize', this.schedule)
    this.gaps?.disconnect()
    this.gaps = null
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private readonly schedule = () => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.look()
    })
  }

  private look() {
    const { body } = this
    if (!body?.isConnected || !this.windowed()) return
    if (!this.fitted) this.fit()

    for (const [index, tr] of this.drawn) {
      const height = tr.getBoundingClientRect().height
      if (height > 0) this.heights.set(index, height)
    }
    if (this.heights.size > 0) {
      let sum = 0
      for (const one of this.heights.values()) sum += one
      this.guess = sum / this.heights.size
    }

    const box = body.getBoundingClientRect()
    if (box.height === 0) return
    const frame = this.editor.scrollDOM.getBoundingClientRect()
    const top = Math.max(frame.top, 0) - box.top
    const bottom = Math.min(frame.bottom, window.innerHeight) - box.top
    if (bottom < 0 || top > box.height) return

    const rows = this.model.rows.length
    const first = this.rowAtY(top)
    const last = this.rowAtY(bottom)
    const from = Math.max(0, Math.floor((first - AROUND) / STEP) * STEP)
    const to = Math.min(rows, Math.ceil((last + 1 + AROUND) / STEP) * STEP)
    if (from === this.shown.from && to === this.shown.to) return

    this.shown = { from, to }
    this.fill()
  }

  private rowAtY(y: number): number {
    const rows = this.model.rows.length
    let at = 0
    for (let row = 0; row < rows; row++) {
      at += this.heights.get(row) ?? this.guess
      if (at > y) return row
    }
    return rows - 1
  }

  private cell(text: string, at: CellAddress, tag: 'th' | 'td', editing: boolean) {
    const cell = element(tag)
    cell.contentEditable = this.editable ? 'true' : 'false'
    cell.spellcheck = true
    cell.dataset.row = String(at.row)
    cell.dataset.column = String(at.column)

    cell.dataset.source = text
    if (editing) showSource(cell)
    else showRendered(cell)

    const align = this.model.align[at.column]
    if (align) cell.style.textAlign = align

    cell.addEventListener('mousedown', (event) => {
      if (this.editor.state.readOnly) return
      if (event.button !== 0 || document.activeElement === cell) return
      event.preventDefault()
      cell.focus()
      selectAtPoint(cell, event.clientX, event.clientY)
    })

    cell.addEventListener('focus', () => showSource(cell))
    cell.addEventListener('blur', () => queueMicrotask(() => this.left(cell, at)))
    cell.addEventListener('input', (event) => {
      if (!(event as InputEvent).isComposing) this.edited(cell, at)
    })
    cell.addEventListener('compositionend', () => this.edited(cell, at))
    cell.addEventListener('keydown', (event) => this.keyInCell(event, cell, at))
    cell.addEventListener('beforeinput', (event) => this.inputInCell(event, cell, at))
    cell.addEventListener('paste', (event) => this.pasteInCell(event, cell, at))

    return cell
  }

  private edited(cell: HTMLElement, at: CellAddress) {
    if (this.editor.state.readOnly) {
      cell.blur()
      return
    }

    this.pending = { at, value: cell.textContent }
    holdsEdit(this)

    window.clearTimeout(this.idle)
    this.idle = window.setTimeout(() => this.flush(), IDLE_COMMIT)
  }

  private left(cell: HTMLElement, at: CellAddress) {
    if (!attached(cell)) return
    this.flush()
    if (!attached(cell)) return

    cell.dataset.source = this.textOf(at)
    showRendered(cell)
  }

  private keyInCell(event: KeyboardEvent, cell: HTMLElement, at: CellAddress) {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the one sign Safari gives
    if (event.isComposing || event.keyCode === 229) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key

    if (key === 'Tab' && !mod && !event.altKey) {
      event.preventDefault()
      const next = event.shiftKey ? cellBefore(this.model, at) : cellAfter(this.model, at)
      if (next === 'below') this.growBelow(0)
      else if (next === 'above') this.leave('above', 'end')
      else this.focusCell(next, event.shiftKey ? 'end' : 'start')
      return
    }

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
      if (lower === 'z' && !event.shiftKey) {
        this.history(event, undoEdit, cell, at)
        return
      }
      if (lower === 'y' || (lower === 'z' && event.shiftKey)) {
        this.history(event, redoEdit, cell, at)
        return
      }
      if (lower === 'a' && !event.shiftKey) {
        event.preventDefault()
        selectIn(cell, 0, cell.textContent.length)
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
        this.stepVertically(cellAbove(at), cell, 'above')
        return
      case 'ArrowDown':
        if (!caretAtEdge(cell, 'bottom')) return
        event.preventDefault()
        this.stepVertically(cellBelow(this.model, at), cell, 'below')
        return
      case 'ArrowLeft': {
        if (!collapsedAt(cell, 0)) return
        event.preventDefault()
        const previous = cellBefore(this.model, at)
        if (previous === 'above') this.leave('above', 'end')
        else if (previous !== 'below') this.focusCell(previous, 'end')
        return
      }
      case 'ArrowRight': {
        if (!collapsedAt(cell, cell.textContent.length)) return
        event.preventDefault()
        const next = cellAfter(this.model, at)
        if (next === 'below') this.leave('below', 'start')
        else if (next !== 'above') this.focusCell(next, 'start')
        return
      }
    }
  }

  private stepVertically(step: CellAddress | Side, cell: HTMLElement, side: Side) {
    const x = (caretRect() ?? cell.getBoundingClientRect()).left
    if (typeof step === 'string') this.leave(side, { x })
    else this.focusCell(step, { x, edge: side === 'above' ? 'bottom' : 'top' })
  }

  private growBelow(column: number) {
    const rows = this.model.rows.length
    this.apply(insertedRow(this.current(), rows - 1, column))
  }

  private history(event: Event, command: Command, cell: HTMLElement, at: CellAddress) {
    event.preventDefault()
    this.flush()
    this.focusAfter = { at, offset: caretOffset(cell) }
    command(this.editor)
    this.focusAfter = null
  }

  private runInline(command: StateCommand, cell: HTMLElement, at: CellAddress) {
    const selection = selectionIn(cell)
    if (!selection) return

    const result = runInCell(command, cell.textContent, selection.from, selection.to)
    if (!result) return

    cell.textContent = result.text
    selectIn(cell, result.from, result.to)
    this.edited(cell, at)
  }

  private inputInCell(event: InputEvent, cell: HTMLElement, at: CellAddress) {
    const type = event.inputType
    if (type.startsWith('format') || type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault()
    } else if (type === 'historyUndo') {
      this.history(event, undoEdit, cell, at)
    } else if (type === 'historyRedo') {
      this.history(event, redoEdit, cell, at)
    }
  }

  private pasteInCell(event: ClipboardEvent, cell: HTMLElement, at: CellAddress) {
    event.preventDefault()
    const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r?\n/g, ' ')
    if (!text) return

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement reaches the browser's own undo stack
    if (document.execCommand('insertText', false, text)) return

    const selection = selectionIn(cell)
    if (!selection) return
    const before = cell.textContent
    cell.textContent = before.slice(0, selection.from) + text + before.slice(selection.to)
    selectIn(cell, selection.from + text.length)
    this.edited(cell, at)
  }

  private toggleAlign(column: number, align: NonNullable<Align>) {
    this.apply(alignedColumn(this.current(), column, align, this.focusedCell() ?? undefined))
  }

  private sortBy(column: number) {
    const order = this.sortedAs?.column === column && this.sortedAs.order === 'up' ? 'down' : 'up'
    const edit = sortedColumn(this.current(), column, order, this.focusedCell() ?? undefined)
    if (edit.next === this.current()) return

    this.sortedAs = { column, order }
    this.apply(edit)
  }

  private moveColumnBy(column: number, step: number) {
    const edit = movedColumn(this.current(), column, step, this.focusedCell() ?? undefined)
    if (edit.next === this.current()) return

    const [width] = this.widths.splice(column, 1)
    this.widths.splice(column + step, 0, width ?? null)
    this.apply(edit)
  }

  private insertColumnAfter(column: number) {
    this.widths.splice(column + 1, 0, null)
    this.apply(insertedColumn(this.current(), column))
  }

  private deleteColumn(column: number) {
    const edit = removedColumn(this.current(), column, this.focusedCell() ?? undefined)
    if (edit.next === this.current()) return

    this.widths.splice(column, 1)
    this.apply(edit)
  }

  private moveRowBy(row: number, step: number) {
    this.apply(movedRow(this.current(), row, step, this.focusedCell() ?? undefined))
  }

  private insertRowAfter(row: number) {
    this.apply(insertedRow(this.current(), row))
  }

  private deleteRow(row: number) {
    this.apply(removedRow(this.current(), row, this.focusedCell() ?? undefined))
  }

  private apply(edit: Edit) {
    this.commit(edit.next, edit.focus)
  }

  private buildRowBar(): HTMLElement {
    const bar = element('div', 'nib-table-rows')
    bar.contentEditable = 'false'
    bar.append(
      button('nib-table-btn', 'moveRowUp', 'M1 6l4-4 4 4', () => this.moveRowBy(this.barRow, -1)),
      button('nib-table-btn', 'moveRowDown', 'M1 4l4 4 4-4', () => this.moveRowBy(this.barRow, 1)),
      button('nib-table-btn', 'insertRow', 'M5 1v8M1 5h8', () => this.insertRowAfter(this.barRow)),
      button('nib-table-btn nib-table-btn-danger', 'deleteRow', 'M1 1l8 8M9 1l-8 8', () =>
        this.deleteRow(this.barRow),
      ),
    )
    return bar
  }

  private buildColumnBar(): HTMLElement {
    const bar = element('div', 'nib-table-columns')
    bar.contentEditable = 'false'
    bar.append(
      this.alignButtons.left,
      this.alignButtons.center,
      this.alignButtons.right,
      this.columnButton('moveColumnLeft', 'M6 1L2 5l4 4', (column) =>
        this.moveColumnBy(column, -1),
      ),
      this.columnButton('moveColumnRight', 'M4 1l4 4-4 4', (column) =>
        this.moveColumnBy(column, 1),
      ),
      this.columnButton('sortColumn', 'M2 2h6M2 5h4M2 8h2', (column) => this.sortBy(column)),
      this.columnButton('insertColumn', 'M5 1v8M1 5h8', (column) => this.insertColumnAfter(column)),
      this.columnButton(
        'deleteColumn',
        'M1 1l8 8M9 1l-8 8',
        (column) => this.deleteColumn(column),
        true,
      ),
    )
    return bar
  }

  private columnButton(
    name: LabelKey | 'left' | 'center' | 'right',
    path: string,
    onPress: (column: number) => void,
    danger = false,
  ): HTMLButtonElement {
    const key =
      name in ALIGN_LABELS ? ALIGN_LABELS[name as keyof typeof ALIGN_LABELS] : (name as LabelKey)
    const className = danger ? 'nib-table-btn nib-table-btn-danger' : 'nib-table-btn'
    return button(className, key, path, () => onPress(this.barColumn))
  }

  private watchColumnHover() {
    this.dom.addEventListener('pointerover', (event) => {
      if (event.pointerType !== 'mouse') return
      const target = event.target as Element
      const th = target.closest('th')
      if (th && this.table.contains(th)) this.showColumnBar(th)
      else if (!this.columnBar.contains(target)) this.hideColumnBar()
    })
    this.dom.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') this.hideColumnBar()
    })

    this.table.addEventListener('focusin', (event) => {
      const th = (event.target as Element).closest('th')
      if (th) this.showColumnBar(th)
    })
    this.table.addEventListener('focusout', (event) => {
      const next = (event.relatedTarget as Element | null)?.closest('th')
      if (next && this.table.contains(next)) this.showColumnBar(next)
      else this.hideColumnBar()
    })

    this.scroller.addEventListener('scroll', () => {
      const th = this.headerCell(this.barColumn)
      if (th && this.columnBar.classList.contains('is-shown')) this.showColumnBar(th)
    })
  }

  private watchRowHover() {
    this.dom.addEventListener('pointerover', (event) => {
      if (event.pointerType !== 'mouse') return
      const target = event.target as Element
      const tr = target.closest('tr')
      if (tr?.dataset.row !== undefined && this.table.tBodies[0]?.contains(tr)) this.showRowBar(tr)
      else if (!this.rowBar.contains(target)) this.hideRowBar()
    })
    this.dom.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') this.hideRowBar()
    })

    this.table.addEventListener('focusin', (event) => {
      const tr = (event.target as Element).closest('td')?.closest('tr')
      if (tr) this.showRowBar(tr)
    })
    this.table.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as Element | null
      if (next && this.rowBar.contains(next)) return
      const tr = next?.closest('td')?.closest('tr')
      if (tr && this.table.contains(tr)) this.showRowBar(tr)
      else this.hideRowBar()
    })

    this.table.addEventListener('input', (event) => {
      const tr = (event.target as Element).closest('td')?.closest('tr')
      if (tr) this.showRowBar(tr)
    })
  }

  private bodyRow(row: number): HTMLTableRowElement | undefined {
    return this.drawn.get(row)
  }

  private showRowBar(tr: HTMLTableRowElement) {
    this.barRow = Number(tr.dataset.row)

    const bar = this.rowBar
    bar.classList.add('is-shown')
    const wrap = this.dom.getBoundingClientRect()
    const row = tr.getBoundingClientRect()
    bar.style.top = `${row.top - wrap.top + row.height / 2}px`
  }

  private hideRowBar() {
    const focused = document.activeElement?.closest('td')?.closest('tr')
    if (focused && this.table.contains(focused)) this.showRowBar(focused)
    else this.rowBar.classList.remove('is-shown')
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

  private hideColumnBar() {
    const focused = document.activeElement?.closest('th')
    if (focused && this.table.contains(focused)) this.showColumnBar(focused)
    else this.columnBar.classList.remove('is-shown')
  }

  private startResize(event: MouseEvent, header: HTMLTableCellElement, column: number) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = header.getBoundingClientRect().width
    const factor = getComputedStyle(header).direction === 'rtl' ? -1 : 1

    const move = (moved: MouseEvent) => {
      const width = Math.max(48, startWidth + (moved.clientX - startX) * factor)
      this.widths[column] = width
      header.style.width = `${width}px`
      this.fitWidth()
    }
    const finish = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', finish)
      this.dragging = null
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', finish)
    this.dragging = finish
  }

  private cellAt(at: CellAddress): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(
      `[data-row="${at.row}"][data-column="${at.column}"]`,
    )
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

  private columnAt(row: number, x: number): number {
    this.reach(row)
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

function around(row: number, rows: number): { from: number; to: number } {
  return {
    from: Math.max(0, Math.floor((row - AROUND) / STEP) * STEP),
    to: Math.min(rows, Math.ceil((row + 1 + AROUND) / STEP) * STEP),
  }
}

function keepEdit(editor: EditorView, from: number, source: string, text: string) {
  const { state } = editor
  if (state.readOnly || state.doc.sliceString(from, from + source.length) !== source) return
  editor.dispatch({ changes: { from, to: from + source.length, insert: text } })
}
