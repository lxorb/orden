const WORDS = new Set(['text', 'search', 'url', 'email', 'tel'])

export function keepsSystemMenu(target: EventTarget | null, system: string): boolean {
  if (system !== 'macos' || target === null) return false

  const field = target as { tagName?: unknown; type?: unknown }
  if (field.tagName === 'TEXTAREA') return true
  return field.tagName === 'INPUT' && typeof field.type === 'string' && WORDS.has(field.type)
}

export function macMenuKey(event: KeyboardEvent): boolean {
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return false
  const on = document.activeElement
  if (event.defaultPrevented || !on || on === document.body) return true

  event.preventDefault()
  on.dispatchEvent(pressAt(caretBox(on) ?? on.getBoundingClientRect()))
  return true
}

function pressAt(box: DOMRect): MouseEvent {
  return new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(box.left + Math.min(box.width / 2, 120)),
    clientY: Math.round(box.top + box.height / 2),
  })
}

function caretBox(on: Element): DOMRect | null {
  const selection = on.ownerDocument.getSelection()
  const at = selection?.focusNode
  if (!selection || !at || !on.contains(at)) return null

  const caret = on.ownerDocument.createRange()
  caret.setStart(at, selection.focusOffset)
  caret.collapse(true)
  const box = caret.getBoundingClientRect()
  if (box.height) return box

  const line = at.nodeType === Node.ELEMENT_NODE ? (at as Element) : at.parentElement
  return line && line !== on ? line.getBoundingClientRect() : null
}
