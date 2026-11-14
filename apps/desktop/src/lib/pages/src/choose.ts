export interface Caret {
  node: Text
  offset: number
}

export interface Chosen {
  from: Caret
  to: Caret
}

interface Caretful {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

function wordsText(node: Node | null | undefined): node is Text {
  return node?.nodeType === 3 && !!node.parentElement?.closest('.words.live')
}

export function caretAt(doc: Document, x: number, y: number): Caret | null {
  const asked: Caretful = doc
  const position = asked.caretPositionFromPoint?.(x, y)
  const range = position ? null : asked.caretRangeFromPoint?.(x, y)
  const node = position ? position.offsetNode : range?.startContainer
  const offset = position ? position.offset : (range?.startOffset ?? 0)

  return wordsText(node) ? { node, offset: Math.min(offset, node.length) } : null
}

export function wordAround(at: Caret): Chosen {
  const text = at.node.data
  let from = Math.min(at.offset, text.length)
  let to = from
  while (from > 0 && !/\s/.test(text.charAt(from - 1))) from--
  while (to < text.length && !/\s/.test(text.charAt(to))) to++
  return { from: { node: at.node, offset: from }, to: { node: at.node, offset: to } }
}

function before(one: Caret, other: Caret): boolean {
  const range = one.node.ownerDocument.createRange()
  range.setStart(other.node, other.offset)
  return range.comparePoint(one.node, one.offset) < 0
}

export function chooseTo(selection: Selection, held: Chosen, at: Caret): void {
  const [base, extent] = before(at, held.from)
    ? [held.to, at]
    : before(held.to, at)
      ? [held.from, at]
      : [held.from, held.to]
  selection.setBaseAndExtent(base.node, base.offset, extent.node, extent.offset)
}

export function chosenIn(root: Element | undefined): string {
  const selection = root?.ownerDocument.getSelection()
  if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return ''
  const anchor = selection.anchorNode
  return anchor && root.contains(anchor) && wordsText(anchor) ? selection.toString() : ''
}
