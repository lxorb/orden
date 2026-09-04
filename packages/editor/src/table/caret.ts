/** The browser's own caret, inside a cell. Cells are contenteditable, so the
 *  caret in them is the DOM selection rather than the editor's. */

/** Where the selection's ends sit in an element, as distances into its text.
 *  Null when the selection is somewhere else. */
export function selectionIn(element: HTMLElement): { from: number; to: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null

  return {
    from: offsetOf(element, range.startContainer, range.startOffset),
    to: offsetOf(element, range.endContainer, range.endOffset),
  }
}

export function caretOffset(element: HTMLElement): number {
  return selectionIn(element)?.to ?? 0
}

function offsetOf(element: HTMLElement, node: Node, offset: number): number {
  const measured = document.createRange()
  measured.selectNodeContents(element)
  measured.setEnd(node, offset)
  return measured.toString().length
}

/** Puts the selection at distances into an element's text. */
export function selectIn(element: HTMLElement, from: number, to = from) {
  const range = document.createRange()
  range.setStart(...pointAt(element, from))
  range.setEnd(...pointAt(element, to))
  apply(range)
}

/** Puts the caret at the spot in an element nearest to a point on screen. */
export function selectAtPoint(element: HTMLElement, x: number, y: number) {
  // Optional calls: WebKitGTK and WebView2 differ on which of the two exists.
  let range = document.caretRangeFromPoint?.(x, y) ?? null

  if (!range) {
    const position = document.caretPositionFromPoint?.(x, y)
    if (position) {
      range = document.createRange()
      range.setStart(position.offsetNode, position.offset)
    }
  }

  if (!range || !element.contains(range.startContainer)) {
    range = document.createRange()
    range.selectNodeContents(element)
  }

  range.collapse(true)
  apply(range)
}

/** The caret's own rectangle, when the browser can say where it is. It
 *  cannot for a caret in an empty text node. */
export function caretRect(): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  return rect.height > 0 ? rect : null
}

/** The boxes an element's text is laid out in, in reading order. Text that
 *  wraps has several; the first is on the top row and the last on the bottom. */
export function textRows(element: HTMLElement): DOMRect[] {
  const range = document.createRange()
  range.selectNodeContents(element)
  return Array.from(range.getClientRects()).filter((rect) => rect.height > 0)
}

/** Whether the caret is on the top (or bottom) row of an element's text, past
 *  which an arrow key should leave the element rather than move within it.
 *  What cannot be measured counts as an edge, so the key always does something. */
export function caretAtEdge(element: HTMLElement, edge: 'top' | 'bottom'): boolean {
  const rows = textRows(element)
  const caret = caretRect()
  if (rows.length < 2 || !caret) return true

  const y = (caret.top + caret.bottom) / 2
  const row = edge === 'top' ? rows[0] : rows[rows.length - 1]
  return y >= row.top - 1 && y <= row.bottom + 1
}

/** The text node and offset a distance into an element's text falls in. */
function pointAt(element: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (remaining <= node.length) return [node, remaining]
    remaining -= node.length
    last = node
  }

  return last ? [last, last.length] : [element, 0]
}

function apply(range: Range) {
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
