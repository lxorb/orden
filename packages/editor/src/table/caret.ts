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

export function selectIn(element: HTMLElement, from: number, to = from) {
  const range = document.createRange()
  range.setStart(...pointAt(element, from))
  range.setEnd(...pointAt(element, to))
  apply(range)
}

interface CaretFromPoint {
  caretRangeFromPoint?: (x: number, y: number) => Range | null
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
}

export function selectAtPoint(element: HTMLElement, x: number, y: number) {
  const finder: CaretFromPoint = document
  let range = finder.caretRangeFromPoint?.(x, y) ?? null

  if (!range) {
    const position = finder.caretPositionFromPoint?.(x, y)
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

export function caretRect(): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  return rect.height > 0 ? rect : null
}

export function textRows(element: HTMLElement): DOMRect[] {
  const range = document.createRange()
  range.selectNodeContents(element)
  return Array.from(range.getClientRects()).filter((rect) => rect.height > 0)
}

export function caretAtEdge(element: HTMLElement, edge: 'top' | 'bottom'): boolean {
  const rows = textRows(element)
  const caret = caretRect()
  if (rows.length < 2 || !caret) return true

  const y = (caret.top + caret.bottom) / 2
  const row = edge === 'top' ? rows[0] : rows.at(-1)
  if (!row) return true
  return y >= row.top - 1 && y <= row.bottom + 1
}

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
