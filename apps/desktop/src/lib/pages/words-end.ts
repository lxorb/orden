function anchorOf(range: Range, start: boolean): Node | null {
  let anchor: Node | null = start ? range.startContainer : range.endContainer
  if (anchor.nodeType === 3) anchor = anchor.parentNode
  if (start || range.endOffset !== 0) return anchor

  do {
    while (anchor && !anchor.previousSibling) anchor = anchor.parentNode
    anchor = anchor?.previousSibling ?? null
  } while (anchor && !anchor.childNodes.length)
  return anchor
}

function besideLine(
  layer: HTMLElement,
  x: number,
  y: number,
): { text: Text; offset: number } | null {
  let best: { text: Text; offset: number; gap: number } | null = null
  for (const span of layer.querySelectorAll('span')) {
    const text = span.firstChild
    if (span.childNodes.length !== 1 || !(text instanceof Text)) continue
    const box = span.getBoundingClientRect()
    if (y < box.top || y > box.bottom) continue
    if (x >= box.left && x <= box.right) return null
    const after = x > box.right
    const gap = after ? x - box.right : box.left - x
    if (!best || gap < best.gap) best = { text, offset: after ? text.length : 0, gap }
  }
  return best
}

export function wordsEnd(layer: HTMLElement): () => void {
  const doc = layer.ownerDocument
  const end = doc.createElement('div')
  end.className = 'end'
  layer.append(end)

  const leaving = new AbortController()
  const { signal } = leaving
  let down = false
  let last: Range | null = null

  const reset = () => {
    down = false
    last = null
    layer.append(end)
    layer.classList.remove('selecting')
  }

  layer.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      down = true
      layer.classList.add('selecting')
    },
    { signal },
  )
  doc.addEventListener(
    'pointermove',
    (event) => {
      if (!down) return
      const selection = doc.getSelection()
      const anchor = selection?.anchorNode
      if (!selection?.rangeCount || !anchor || !layer.contains(anchor)) return
      const beside = besideLine(layer, event.clientX, event.clientY)
      if (beside) selection.extend(beside.text, beside.offset)
    },
    { signal },
  )
  doc.addEventListener('pointerup', () => down && reset(), { signal })
  doc.defaultView?.addEventListener('blur', () => down && reset(), { signal })

  doc.addEventListener(
    'selectionchange',
    () => {
      if (!down) return
      const selection = doc.getSelection()
      if (!selection?.rangeCount) return

      const range = selection.getRangeAt(0)
      const start =
        !!last &&
        (range.compareBoundaryPoints(Range.END_TO_END, last) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, last) === 0)
      const anchor = anchorOf(range, start)
      last = range.cloneRange()

      const parent = anchor?.parentNode
      if (!anchor || anchor === end || !parent || !layer.contains(parent)) return
      parent.insertBefore(end, start ? anchor : anchor.nextSibling)
    },
    { signal },
  )

  return () => {
    leaving.abort()
    end.remove()
    layer.classList.remove('selecting')
  }
}
