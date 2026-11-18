import {
  type ChangeSet,
  type ChangeSpec,
  EditorSelection,
  MapMode,
  type Text,
  type StateCommand,
  type StateEffect,
  Transaction,
} from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { linkOpener, modifier } from '../links'
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
  offsetAtPoint,
  selectAtPoint,
  selectIn,
  selectionIn,
  textRows,
} from './caret'
import {
  type Align,
  columnWidth,
  columnWidths,
  displayWidth,
  nameAfter,
  type Order,
  parseTable,
  sameModel,
  serializeRow,
  serializeTable,
  setCell,
  type TableModel,
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
  type TableSpan,
  tableAt,
  changesDuring,
  tableWrite,
  writingTable,
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
import { sourceOffset } from './inline'
import { inlineShortcut, runInCell } from './shortcuts'

export interface TableSource {
  source: string
  from: number
  to: number
}

export type Placement = 'start' | 'end' | 'all' | { x: number; edge: 'top' | 'bottom' }

export type Landing = 'start' | 'end' | { x: number }

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

export class TableView {
  readonly dom: HTMLElement
  private readonly scroller: HTMLElement
  private readonly table: HTMLTableElement
  private readonly columnBar: HTMLElement
  private readonly rowBar: HTMLElement
  private readonly alignButtons: Record<'left' | 'center' | 'right', HTMLButtonElement>
  private model: TableModel
  private source: string

  private pending: { at: CellAddress; value: string } | null = null
  private start: number | null = null
  private aligned: number[] | null = null
  private expected: { source: string; model: TableModel; widths: number[] } | null = null

  private focusAfter: Focus | null = null
  private composing = false

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
    this.start = text.from
    this.widths = model.header.map(() => null)
    this.editable = !editor.state.readOnly

    this.dom = element('div', 'orden-table-wrap')
    this.dom.contentEditable = 'false'

    this.scroller = element('div', 'orden-table-scroll')
    this.table = element('table', 'orden-table')
    this.scroller.append(this.table)

    const align = (side: 'left' | 'center' | 'right') =>
      this.columnButton(`Align ${side}`, ALIGN_PATHS[side], (column) =>
        this.toggleAlign(column, side),
      )
    this.alignButtons = { left: align('left'), center: align('center'), right: align('right') }
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

  continues(text: TableSource): boolean {
    return this.start === text.from
  }

  get tracked(): number | null {
    return this.start
  }

  track(changes: ChangeSet, doc: Text) {
    const { start } = this
    if (start === null) return
    const exact = changes.mapPos(start, 1, MapMode.TrackAfter)
    if (exact !== null) {
      this.start = exact
      return
    }

    this.start = null
    const header = headerOf(this.source)
    changes.iterChanges((fromA, toA, fromB, toB) => {
      if (start < fromA || start >= toA) return
      const aimed = fromB + (start - fromA)
      let nearest: number | null = null
      for (let pos = fromB; pos < toB;) {
        const line = doc.lineAt(pos)
        if (line.to <= toB && headerOf(line.text) === header) {
          if (nearest === null || Math.abs(line.from - aimed) < Math.abs(nearest - aimed)) {
            nearest = line.from
          }
        }
        pos = line.to + 1
      }
      this.start = nearest
    })
  }

  sameTable(model: TableModel): boolean {
    return this.model.header.every((text, column) => model.header[column] === text)
  }

  private placeOf(model: TableModel): CellAddress | null {
    const { pending } = this
    if (!pending) return null
    const { row, column } = pending.at
    const written = setCell(this.model, row, column, pending.value)
    const mine = (row < 0 ? written.header : written.rows[row]) ?? []
    const cell = mine[column]?.trim()
    if (cell === undefined) return null
    if (row < 0) return model.header[column] === cell ? pending.at : null

    const whole = (cells: string[] | undefined) =>
      cells?.length === mine.length &&
      cells.every((text, at) => text === (at === column ? cell : mine[at]))
    if (whole(model.rows[row])) return pending.at
    const found = model.rows.flatMap((cells, at) => (whole(cells) ? [at] : []))
    if (found.length === 1 && found[0] !== undefined) return { row: found[0], column }
    if (found.length > 1) return null
    return model.rows[row]?.[column] === cell ? pending.at : null
  }

  adopt(text: TableSource, model: TableModel) {
    const before = this.model
    const place = this.placeOf(model)
    const kept = place !== null
    if (place && this.pending && !sameCell(place, this.pending.at)) {
      const focused = this.focusedCell()
      if (focused && !this.focusAfter) this.focusAfter = { at: place, offset: focused.offset }
      this.pending = { at: place, value: this.pending.value }
    }
    const pending = kept ? this.pending : null
    const incoming = pending
      ? setCell(model, pending.at.row, pending.at.column, pending.value)
      : model
    const shown = sameModel(incoming, this.current())
    const expected = this.expected?.source === text.source ? this.expected : null
    this.aligned = expected ? expected.widths : null
    this.source = text.source
    this.start = text.from
    this.model = model
    if (!kept) this.clearPending()

    if (shown && this.editable === !this.editor.state.readOnly) {
      this.focusAfter = null
      return
    }
    if (this.composing && !this.focusAfter && this.editable === !this.editor.state.readOnly) {
      if (this.patch(before)) return
    }
    this.editable = !this.editor.state.readOnly
    this.render()
  }

  private patch(before: TableModel): boolean {
    const { model } = this
    const same =
      before.header.length === model.header.length &&
      before.rows.length === model.rows.length &&
      before.align.every((align, column) => model.align[column] === align)
    if (!same) return false

    const focused = this.focusedCell()?.at
    if (focused && textIn(model, focused) !== textIn(before, focused)) return false
    if (focused && movedAway(before, model, focused.row)) return false
    for (const cell of this.table.querySelectorAll<HTMLElement>('[data-row][data-column]')) {
      const at = { row: Number(cell.dataset.row), column: Number(cell.dataset.column) }
      if (sameCell(at, focused)) continue
      const text = this.shownText(at, textIn(model, at))
      if (cell.dataset.source === text) continue
      cell.dataset.source = text
      showRendered(cell)
    }
    return true
  }

  modelFor(source: string): TableModel | null {
    return this.expected?.source === source ? this.expected.model : parseTable(source)
  }

  focusState(): { at: CellAddress; offset: number } | null {
    return this.focusedCell()
  }

  destroy() {
    this.clearPending()
    this.dragging?.()
    this.unfollow()
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

    this.focusAfter = focus ?? null
    const widths = columnWidths(next)
    this.write(serializeTable(next, widths), 'input', next, widths)
    this.clearPending()
    this.focusAfter = null
  }

  private write(text: string, userEvent: string, model: TableModel, widths: number[]): boolean {
    const { editor } = this
    const from = this.span()?.from ?? this.start
    if (from === null) return false
    if (text === this.source) {
      this.aligned = widths
      return false
    }
    if (editor.state.doc.sliceString(from, from + this.source.length) !== this.source) return false

    this.keepCaretBeside(from, from + this.source.length)
    this.expected = { source: text, model, widths }
    try {
      editor.dispatch({
        changes: lineChanges(from, this.source, text),
        userEvent,
        annotations: tableWrite.of(true),
      })
    } finally {
      this.expected = null
    }
    return true
  }

  private keepCaretBeside(from: number, to: number) {
    const { state } = this.editor
    const blank = (pos: number) => !state.doc.lineAt(pos).text.trim()
    const beside = [to + 1, from - 1].find(
      (pos) => pos >= 0 && pos <= state.doc.length && blank(pos),
    )
    if (beside === undefined) return
    const { main } = state.selection
    if (state.selection.ranges.length === 1 && main.empty && main.head === beside) return
    this.editor.dispatch({
      selection: { anchor: beside },
      annotations: [tableWrite.of(true), Transaction.addToHistory.of(false)],
    })
  }

  private typeIn(at: CellAddress) {
    const next = this.current()
    const widths = this.aligned
    if (!widths) {
      const fresh = columnWidths(next)
      this.write(serializeTable(next, fresh), 'input.type', next, fresh)
      return
    }

    const { row, column } = at
    const before = (row < 0 ? this.model.header : this.model.rows[row])?.[column] ?? ''
    const cells = (row < 0 ? next.header : next.rows[row]) ?? []
    const now = cells[column] ?? ''
    const width = widths[column] ?? 0
    let wide = width
    if (displayWidth(now) > width) wide = displayWidth(now)
    else if (displayWidth(before) >= width) wide = columnWidth(next, column)

    const sized = widths.slice()
    sized[column] = wide
    if (wide !== width) {
      this.write(serializeTable(next, sized), 'input.type', next, sized)
      return
    }

    const lines = this.source.split('\n')
    lines[row < 0 ? 0 : row + 2] =
      serializeRow(cells, sized) + (row < 0 ? '' : nameAfter(next, row))
    this.write(lines.join('\n'), 'input.type', next, sized)
  }

  private clearPending() {
    this.pending = null
    if (active === this) active = null
  }

  private shownText(at: CellAddress, text: string): string {
    const { pending } = this
    return pending && sameCell(at, pending.at) ? pending.value : text
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
      const th = this.cell(this.shownText(at, text), at, 'th', sameCell(at, focus?.at))

      const grip = element('span', 'orden-table-resize')
      grip.contentEditable = 'false'
      grip.title = 'Drag to resize'
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
    this.table.classList.toggle('orden-table-windowed', fixed)
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
      return this.cell(this.shownText(at, text), at, 'td', sameCell(at, editing))
    })
    tr.append(...cells)
    this.drawn.set(index, tr)
    return tr
  }

  private gap(from: number, to: number): HTMLTableRowElement {
    const tr = element('tr', 'orden-table-gap')
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
      for (const one of wanted)
        if (one.classList.contains('orden-table-gap')) this.gaps.observe(one)
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
      for (const one of this.body?.querySelectorAll('.orden-table-gap') ?? [])
        this.gaps.observe(one)
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

  private followedLink(event: MouseEvent): boolean {
    const asked =
      event.button === 1 || (event.button === 0 && (modifier(event) || this.editor.state.readOnly))
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null
    const href = target?.getAttribute('href')
    if (!asked || !href) return false

    event.preventDefault()
    event.stopPropagation()
    this.editor.state.facet(linkOpener)(href, event)
    return true
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

    cell.addEventListener('auxclick', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault()
    })
    cell.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault()
    })

    cell.addEventListener('mousedown', (event) => {
      if (this.followedLink(event)) return
      if (this.editor.state.readOnly) return
      if (event.button !== 0 || document.activeElement === cell) return
      const source = cell.dataset.source ?? ''
      const shown = offsetAtPoint(cell, event.clientX, event.clientY)
      const drawn = cell.textContent !== source
      event.preventDefault()
      cell.focus()
      if (shown === null) selectAtPoint(cell, event.clientX, event.clientY)
      else selectIn(cell, drawn ? sourceOffset(source, shown) : shown)
    })

    cell.addEventListener('focus', () => showSource(cell))
    cell.addEventListener('blur', () => {
      this.composing = false
      queueMicrotask(() => this.left(cell, at))
    })
    cell.addEventListener('input', (event) => {
      if (!(event as InputEvent).isComposing) this.edited(cell, at)
    })
    cell.addEventListener('compositionstart', () => (this.composing = true))
    cell.addEventListener('compositionend', () => {
      this.composing = false
      this.edited(cell, at)
    })
    cell.addEventListener('keydown', (event) => this.keyInCell(event, cell, at))
    cell.addEventListener('beforeinput', (event) => this.inputInCell(event, cell, at))
    cell.addEventListener('paste', (event) => this.pasteInCell(event, cell, at))
    cell.addEventListener(PASTE_TEXT, (event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string')
        this.typeInCell(event.detail, cell, at)
    })

    return cell
  }

  private edited(cell: HTMLElement, at: CellAddress) {
    if (!attached(cell)) return
    if (this.editor.state.readOnly) {
      cell.blur()
      return
    }

    this.pending = { at, value: cell.textContent }
    holdsEdit(this)
    this.typeIn(at)
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
    const scroll = this.editor.scrollSnapshot()
    const made = changesDuring(this.editor, () => writingTable(() => command(this.editor)))
    const kept = made.reduce<StateEffect<unknown> | undefined>(
      (effect, changes) => effect?.map(changes),
      scroll,
    )
    if (kept) this.editor.dispatch({ effects: kept, annotations: tableWrite.of(true) })
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
    this.typeInCell(event.clipboardData?.getData('text/plain') ?? '', cell, at)
  }

  private typeInCell(said: string, cell: HTMLElement, at: CellAddress) {
    if (this.editor.state.readOnly) return
    const text = said.replace(/\r?\n/g, ' ')
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
    const current = this.current()
    const focus = this.focusedCell() ?? undefined
    const asked = this.sortedAs?.column === column && this.sortedAs.order === 'up' ? 'down' : 'up'
    const other = asked === 'up' ? 'down' : 'up'
    for (const order of [asked, other] as const) {
      const edit = sortedColumn(current, column, order, focus)
      if (edit.next === current) continue
      this.sortedAs = { column, order }
      this.apply(edit)
      return
    }
  }

  private moveColumnBy(column: number, step: number) {
    const current = this.current()
    const edit = movedColumn(current, column, step, this.focusedCell() ?? undefined)
    if (edit.next === current) return

    const [width] = this.widths.splice(column, 1)
    this.widths.splice(column + step, 0, width ?? null)
    this.apply(edit)
  }

  private insertColumnAfter(column: number) {
    this.widths.splice(column + 1, 0, null)
    this.apply(insertedColumn(this.current(), column))
  }

  private deleteColumn(column: number) {
    const current = this.current()
    const edit = removedColumn(current, column, this.focusedCell() ?? undefined)
    if (edit.next === current) return

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
    const bar = element('div', 'orden-table-rows')
    bar.contentEditable = 'false'
    bar.append(
      button('orden-table-btn', 'Move row up', 'M1 6l4-4 4 4', () =>
        this.moveRowBy(this.barRow, -1),
      ),
      button('orden-table-btn', 'Move row down', 'M1 4l4 4 4-4', () =>
        this.moveRowBy(this.barRow, 1),
      ),
      button('orden-table-btn', 'Insert row', 'M5 1v8M1 5h8', () =>
        this.insertRowAfter(this.barRow),
      ),
      button('orden-table-btn orden-table-btn-danger', 'Delete row', 'M1 1l8 8M9 1l-8 8', () =>
        this.deleteRow(this.barRow),
      ),
    )
    return bar
  }

  private buildColumnBar(): HTMLElement {
    const bar = element('div', 'orden-table-columns')
    bar.contentEditable = 'false'
    bar.append(
      this.alignButtons.left,
      this.alignButtons.center,
      this.alignButtons.right,
      this.columnButton('Move column left', 'M6 1L2 5l4 4', (column) =>
        this.moveColumnBy(column, -1),
      ),
      this.columnButton('Move column right', 'M4 1l4 4-4 4', (column) =>
        this.moveColumnBy(column, 1),
      ),
      this.columnButton('Sort by this column', 'M2 2h6M2 5h4M2 8h2', (column) =>
        this.sortBy(column),
      ),
      this.columnButton('Insert column', 'M5 1v8M1 5h8', (column) =>
        this.insertColumnAfter(column),
      ),
      this.columnButton(
        'Delete column',
        'M1 1l8 8M9 1l-8 8',
        (column) => this.deleteColumn(column),
        true,
      ),
    )
    return bar
  }

  private columnButton(
    said: string,
    path: string,
    onPress: (column: number) => void,
    danger = false,
  ): HTMLButtonElement {
    const className = danger ? 'orden-table-btn orden-table-btn-danger' : 'orden-table-btn'
    return button(className, said, path, () => onPress(this.barColumn))
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
    for (const [name, element] of Object.entries(this.alignButtons))
      element.classList.toggle('is-active', name === align)
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
    return textIn(this.model, at)
  }
}

function around(row: number, rows: number): { from: number; to: number } {
  return {
    from: Math.max(0, Math.floor((row - AROUND) / STEP) * STEP),
    to: Math.min(rows, Math.ceil((row + 1 + AROUND) / STEP) * STEP),
  }
}

function headerOf(text: string): string {
  const [first = ''] = text.split('\n', 1)
  return first
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
    .join('|')
}

function movedAway(before: TableModel, model: TableModel, row: number): boolean {
  const was = before.rows[row]
  const now = model.rows[row]
  if (!was || !now || sameCells(was, now)) return false
  return model.rows.some((cells, at) => at !== row && sameCells(cells, was))
}

function sameCells(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((cell, at) => cell === other[at])
}

function textIn(model: TableModel, at: CellAddress): string {
  return (at.row < 0 ? model.header[at.column] : model.rows[at.row]?.[at.column]) ?? ''
}

function lineChanges(from: number, before: string, after: string): ChangeSpec[] {
  const old = before.split('\n')
  const next = after.split('\n')
  if (old.length !== next.length) return [{ from, to: from + before.length, insert: after }]

  const changes: ChangeSpec[] = []
  let at = from
  old.forEach((line, index) => {
    const made = next[index] ?? ''
    if (line !== made) {
      let head = 0
      while (head < line.length && head < made.length && line[head] === made[head]) head++
      let tail = 0
      while (
        tail < line.length - head &&
        tail < made.length - head &&
        line[line.length - 1 - tail] === made[made.length - 1 - tail]
      )
        tail++
      changes.push({
        from: at + head,
        to: at + line.length - tail,
        insert: made.slice(head, made.length - tail),
      })
    }
    at += line.length + 1
  })
  return changes
}

const PASTE_TEXT = 'orden:paste-text'

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
