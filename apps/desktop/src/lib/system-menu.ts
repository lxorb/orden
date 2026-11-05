/** Where a right click still gets the system's own menu.
 *
 *  Nowhere, almost. The app draws its own menu wherever it has something to say -
 *  the file list, the tabs, the note - and a web view's menu everywhere else is a
 *  browser's: Reload, Back, Inspect Element, none of which a desktop app has. So
 *  the window turns it away; see App.svelte.
 *
 *  The one exception is a plain text field on a Mac. There the system's menu is
 *  not a browser's but the Mac's own, and it is the only way to a set of things
 *  every Mac app offers in a field: Look Up, Translate, the spelling suggestions,
 *  Writing Tools, Services, Speech. Bear, Typora and TextEdit all keep it, and a
 *  field of Orden's has no menu of its own to lose.
 *
 *  The note keeps Orden's menu, deliberately. It is where the block moves, the
 *  formatting, the rewrite and the dictionary rows are, and a right click cannot
 *  show two menus; the system's items for a note are out of scope until the note's
 *  menu can carry them. Windows and Linux keep what they had: a field's menu there
 *  is the browser engine's, not the system's. */

/** The kinds of `<input>` that hold words somebody writes. A password is left out:
 *  there is nothing to look up in one, and nothing it should be sent to. */
const WORDS = new Set(['text', 'search', 'url', 'email', 'tel'])

/** Whether a right click on `target` should get the system's menu rather than
 *  none at all. */
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
