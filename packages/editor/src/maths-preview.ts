import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView, type PluginValue, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { loadMaths, mathsEngine } from '@orden/markdown/engines'
import { drawMaths } from './live-preview/render'
import { noReveal } from './live-preview/reveal'
import { nibMarkdownParser } from './markdown/extensions'

/** A formula the caret is in: where its source is and what it says. */
export interface MathsSpan {
  from: number
  to: number
  tex: string
  block: boolean
}

/** The `$…$` or `$$…$$` standing around `pos` in a tree, asked from both sides so a
 *  caret against either dollar counts as inside - which is where the live preview
 *  shows the source too; see `overlaps` in live-preview/reveal.ts. */
function mathsNode(tree: Tree, pos: number): SyntaxNode | null {
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === 'InlineMath' || node.name === 'BlockMath') return node
    }
  }
  return null
}

/** What a formula's source says, without its dollars and, in a quote or a callout,
 *  without the `>` each of its lines is written behind. An unclosed `$$` runs to the
 *  end of the note as the parser reads it, and has only the one mark to take off. */
function texOf(read: (from: number, to: number) => string, node: SyntaxNode): string {
  const text = read(node.from, node.to)
  if (node.name === 'InlineMath') return text.slice(1, -1)

  const closed = node.getChildren('MathMark').length > 1
  let body = text.slice(2, closed ? -2 : undefined)
  let quoted = false
  for (let up = node.parent; up; up = up.parent) if (up.name === 'Blockquote') quoted = true
  if (quoted) body = body.replace(/\n[ \t]*(?:>[ \t]?)*/g, '\n')
  return body.trim()
}

function spanOf(
  read: (from: number, to: number) => string,
  node: SyntaxNode | null,
): MathsSpan | null {
  if (!node) return null
  return { from: node.from, to: node.to, tex: texOf(read, node), block: node.name === 'BlockMath' }
}

/** The formula the main caret of a note is in, or null. Only where the source is
 *  showing: a note nobody can type into keeps its formulas drawn, and so needs no
 *  preview of them. */
export function mathsAtCaret(state: EditorState): MathsSpan | null {
  if (state.readOnly || state.facet(noReveal)) return null
  const { main } = state.selection
  const node = mathsNode(syntaxTree(state), main.head)
  if (!node || main.from < node.from || main.to > node.to) return null
  return spanOf((from, to) => state.doc.sliceString(from, to), node)
}

/** The formula at `offset` in a line of markdown standing on its own - a table
 *  cell's - read by the same parser as the note, so a cell agrees with a paragraph
 *  about what a formula is. */
export function mathsInText(text: string, offset: number): MathsSpan | null {
  return spanOf(
    (from, to) => text.slice(from, to),
    mathsNode(nibMarkdownParser.parse(text), offset),
  )
}

/** Where the preview goes, from what the screen says. Pure, so the rules can be
 *  tested without a browser.
 *
 *  Above the row being typed on and aligned with the formula's start, so it never
 *  covers the line the caret is on; below when there is not the room above, which
 *  is the top of the note. Kept on the side it was on while it still fits there, so
 *  a formula that grows by a keystroke does not jump from one side to the other.
 *  Always inside what is visible of the pane, which on a phone ends above the
 *  keyboard and whatever stands on it. */
export interface Placement {
  top: number
  left: number
  above: boolean
  /** Set when the formula is taller than the room on either side. */
  maxHeight: number | null
}

interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

export const GAP = 6

export function place(
  caret: Box,
  startLeft: number,
  visible: Box,
  size: { width: number; height: number },
  wasAbove: boolean | null,
): Placement | null {
  if (caret.bottom <= visible.top || caret.top >= visible.bottom) return null

  const roomAbove = caret.top - visible.top - GAP
  const roomBelow = visible.bottom - caret.bottom - GAP
  const fitsAbove = size.height <= roomAbove
  const fitsBelow = size.height <= roomBelow
  const above =
    wasAbove === true && fitsAbove
      ? true
      : wasAbove === false && fitsBelow
        ? false
        : fitsAbove || (!fitsBelow && roomAbove >= roomBelow)

  const room = above ? roomAbove : roomBelow
  const height = Math.min(size.height, room)
  const left = Math.max(visible.left + GAP, Math.min(startLeft, visible.right - GAP - size.width))

  return {
    top: above ? caret.top - GAP - height : caret.bottom + GAP,
    left,
    above,
    maxHeight: size.height > room ? Math.max(0, room) : null,
  }
}

/** A render this slow is a sign the next one will be too, so they wait for a pause
 *  in the typing rather than one per key; anything quicker is drawn in the frame
 *  after the keystroke, never inside it. */
const SLOW_MS = 12
const PAUSE_MS = 140

/** What the preview follows: the note's own caret, or a table cell's. A cell is a
 *  field of its own inside the table's widget, with its own caret and its own text
 *  until it is written back, so it is asked about separately. */
type Target =
  | (MathsSpan & { kind: 'note'; head: number; start: number })
  | (MathsSpan & { kind: 'cell'; cell: HTMLElement; caret: number })

/** The cell with the focus, when it is one of this editor's. */
function focusedCell(view: EditorView): HTMLElement | null {
  const active = view.root.activeElement
  if (!(active instanceof HTMLElement) || active === view.contentDOM) return null
  return view.contentDOM.contains(active) && active.isContentEditable ? active : null
}

/** The caret's offset in a cell's text, or null when the selection is elsewhere. */
function caretIn(cell: HTMLElement): number | null {
  const selection = cell.ownerDocument.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed) return null
  const { focusNode, focusOffset } = selection
  if (!focusNode || !cell.contains(focusNode)) return null
  const range = cell.ownerDocument.createRange()
  range.setStart(cell, 0)
  range.setEnd(focusNode, focusOffset)
  return range.toString().length
}

/** A range over `from`..`to` of a cell's text, which is a run of text nodes. */
function cellRange(cell: HTMLElement, from: number, to: number): Range {
  const range = cell.ownerDocument.createRange()
  range.selectNodeContents(cell)
  const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  let seen = 0
  let started = false
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const length = text.textContent?.length ?? 0
    if (!started && from <= seen + length) {
      range.setStart(text, from - seen)
      started = true
    }
    if (started && to <= seen + length) {
      range.setEnd(text, to - seen)
      break
    }
    seen += length
  }
  return range
}

function boxOf(rect: DOMRect | { top: number; bottom: number; left: number; right: number }): Box {
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
}

class Preview implements PluginValue {
  readonly dom: HTMLElement
  private readonly body: HTMLElement
  private readonly error: HTMLElement
  private target: Target | null = null
  /** Which formula the last good picture is of, so another formula never shows it. */
  private drawnFor: number | HTMLElement | null = null
  private drawnTex: string | null = null
  private wantedTex: string | null = null
  private above: boolean | null = null
  private dismissed = false
  private slow = false
  private frame = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly unlisten: (() => void)[] = []

  constructor(private readonly view: EditorView) {
    const dom = document.createElement('div')
    dom.className = 'nib-maths-preview'
    // The source is what is being read out as it is typed; a second voice reading
    // the picture of it on every keystroke would only drown it.
    dom.setAttribute('aria-hidden', 'true')
    dom.hidden = true
    this.body = document.createElement('div')
    this.body.className = 'nib-maths-preview-body'
    this.error = document.createElement('div')
    this.error.className = 'nib-maths-preview-error'
    this.error.hidden = true
    dom.append(this.body, this.error)
    view.dom.append(dom)
    this.dom = dom

    const doc = view.dom.ownerDocument
    const win = doc.defaultView
    const measure = () => this.measure()
    const listen = (target: EventTarget | null | undefined, type: string, run: EventListener) => {
      if (!target) return
      target.addEventListener(type, run, true)
      this.unlisten.push(() => target.removeEventListener(type, run, true))
    }
    listen(view.scrollDOM, 'scroll', measure)
    listen(win, 'resize', measure)
    listen(win?.visualViewport, 'resize', measure)
    listen(win?.visualViewport, 'scroll', measure)
    // A cell's caret moves without the note's selection moving at all.
    listen(doc, 'selectionchange', () => {
      if (focusedCell(view) || this.target?.kind === 'cell') this.follow()
    })
    listen(view.contentDOM, 'input', () => {
      if (!focusedCell(view)) return
      this.dismissed = false
      this.follow()
    })
    // Escape puts it away until the next edit, and is not taken: it still leaves a
    // cell, a menu or Vim's insert mode, which is what the key was pressed for.
    listen(view.dom, 'keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || this.dom.hidden) return
      this.dismissed = true
      this.hide()
    })
    listen(view.contentDOM, 'focusout', () => queueMicrotask(() => this.follow()))
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.dismissed = false
      if (typeof this.drawnFor === 'number') this.drawnFor = update.changes.mapPos(this.drawnFor)
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.follow()
    }
  }

  /** What the caret is in now, and the preview made to match it. */
  follow() {
    const target = this.dismissed ? null : this.find()
    this.target = target
    if (!target?.tex.trim()) {
      this.hide()
      return
    }

    const key = target.kind === 'note' ? target.from : target.cell
    if (key !== this.drawnFor) {
      this.drawnFor = key
      this.drawnTex = null
      this.body.replaceChildren()
      this.above = null
    }
    if (target.tex !== this.wantedTex || this.drawnTex === null) this.schedule(target.tex)
    this.measure()
  }

  private find(): Target | null {
    const { view } = this
    const cell = focusedCell(view)
    if (cell) {
      if (view.state.readOnly) return null
      const caret = caretIn(cell)
      const span = caret === null ? null : mathsInText(cell.textContent, caret)
      return span && caret !== null ? { ...span, kind: 'cell', cell, caret } : null
    }

    if (!view.hasFocus) return null
    const span = mathsAtCaret(view.state)
    if (!span) return null
    const head = view.state.selection.main.head
    const start = span.block ? view.state.doc.lineAt(head).from : span.from
    return { ...span, kind: 'note', head, start }
  }

  private schedule(tex: string) {
    this.wantedTex = tex
    cancelAnimationFrame(this.frame)
    clearTimeout(this.timer)
    if (this.slow) this.timer = setTimeout(() => this.draw(), PAUSE_MS)
    else this.frame = requestAnimationFrame(() => this.draw())
  }

  private draw() {
    const target = this.target
    if (!target) return

    const engine = mathsEngine()
    if (!engine) {
      void loadMaths().then(() => this.target && this.schedule(this.target.tex))
      return
    }

    const scratch = document.createElement('div')
    const started = performance.now()
    try {
      drawMaths(engine, target.tex, target.block, scratch, true)
      this.body.replaceChildren(...scratch.childNodes)
      this.drawnTex = target.tex
      this.error.hidden = true
      this.error.textContent = ''
      this.dom.classList.remove('nib-maths-preview-stale')
    } catch (error) {
      // The last formula that parsed stays up, faded, with what is wrong under it:
      // a preview that blinked out at every half-typed `\frac{` would be no help.
      const message = error instanceof Error ? error.message : String(error)
      this.error.textContent = message.replace(/^KaTeX parse error:\s*/, '')
      this.error.hidden = false
      this.dom.classList.toggle('nib-maths-preview-stale', this.drawnTex !== null)
    }
    this.slow = performance.now() - started > SLOW_MS
    this.measure()
  }

  private hide() {
    cancelAnimationFrame(this.frame)
    clearTimeout(this.timer)
    this.wantedTex = null
    if (!this.dom.hidden) this.dom.hidden = true
  }

  private measure() {
    if (!this.target || this.dismissed) return
    this.view.requestMeasure({ key: this, read: () => this.read(), write: (m) => this.write(m) })
  }

  private read() {
    const { view, target } = this
    if (!target) return null

    let caret: Box
    let startLeft: number
    if (target.kind === 'note') {
      const at = view.coordsAtPos(target.head, -1) ?? view.coordsAtPos(target.head, 1)
      const start = view.coordsAtPos(target.start, 1)
      if (!at) return null
      caret = boxOf(at)
      // Aligned with the formula where it starts on the caret's row; a formula that
      // wrapped onto this row from the one before starts at the caret instead.
      startLeft = start && Math.abs(start.bottom - at.bottom) < 2 ? start.left : at.left
    } else {
      if (!target.cell.isConnected) return null
      const rect = cellRange(target.cell, target.from, target.to).getBoundingClientRect()
      caret = boxOf(rect)
      startLeft = rect.left
    }

    const scroller = boxOf(view.scrollDOM.getBoundingClientRect())
    const visible = { ...scroller }
    for (const margins of view.state.facet(EditorView.scrollMargins)) {
      const given = margins(view)
      if (!given) continue
      visible.top += given.top ?? 0
      visible.bottom -= given.bottom ?? 0
    }
    const viewport = view.dom.ownerDocument.defaultView?.visualViewport
    if (viewport) {
      visible.top = Math.max(visible.top, viewport.offsetTop)
      visible.bottom = Math.min(visible.bottom, viewport.offsetTop + viewport.height)
    }

    return {
      caret,
      startLeft,
      visible,
      editor: view.dom.getBoundingClientRect(),
      font: getComputedStyle(view.contentDOM).fontSize,
    }
  }

  private write(measured: ReturnType<Preview['read']>) {
    const { dom } = this
    // Nothing to show until something is drawn - or, before anything has parsed,
    // the error alone, so the writer still sees why.
    const nothing = !this.body.hasChildNodes() && this.error.hidden
    if (!measured || !this.target || this.dismissed || nothing) {
      dom.hidden = true
      return
    }

    const { caret, startLeft, visible, editor, font } = measured
    dom.style.fontSize = font
    dom.style.maxWidth = `${Math.max(0, visible.right - visible.left - 2 * GAP)}px`
    dom.style.maxHeight = ''
    dom.hidden = false
    const size = { width: dom.offsetWidth, height: dom.offsetHeight }

    const placement = place(caret, startLeft, visible, size, this.above)
    if (!placement) {
      dom.hidden = true
      return
    }
    this.above = placement.above
    dom.classList.toggle('nib-maths-preview-below', !placement.above)
    if (placement.maxHeight !== null) dom.style.maxHeight = `${placement.maxHeight}px`
    dom.style.top = `${placement.top - editor.top}px`
    dom.style.left = `${placement.left - editor.left}px`
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    clearTimeout(this.timer)
    for (const stop of this.unlisten) stop()
    this.dom.remove()
  }
}

/** A live picture of the formula being written, over its source (#1075): every
 *  `$…$` and `$$…$$` of every editor - a note, a canvas card, a task's description,
 *  a table's cell - in live preview and in source mode alike, drawn by the same
 *  `drawMaths` as the note's own formulas so the two never disagree. Opened by the
 *  door in editor.ts, which fetches this module with the first dollar a note has. */
export function openPreview(view: EditorView): PluginValue & { update(update: ViewUpdate): void } {
  const preview = new Preview(view)
  preview.follow()
  return preview
}
