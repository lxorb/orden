/** What leaves the editor on the clipboard.
 *
 *  The note is markdown, so markdown is what a text field is handed. But a word
 *  processor, a document editor and a mail client all read HTML, and handing them
 *  markdown means handing them `**bold**` as three words. Somebody who copies a
 *  heading and a list into an email wants a heading and a list.
 *
 *  So a copy carries both: `text/plain` is the markdown exactly as written, and
 *  `text/html` is the same words through the app's own renderer. Whatever is
 *  pasted into picks the one it understands, which makes this no choice for
 *  anybody to make and no row in any menu. Copy as markdown - `Ctrl+Shift+C` - is
 *  the way out of it, the way Paste as plain text is the way out of a rich paste.
 *
 *  An empty selection is left alone. CodeMirror copies the caret's line and
 *  remembers that it did, so that pasting puts the line back as a line, and
 *  nothing here improves on that. */

import type { EditorState, Extension } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { renderMarkdown } from '@nib/markdown'

/** The markdown a copy would take: what is selected, or the whole note when
 *  nothing is. */
function selected(state: EditorState): string {
  const { from, to } = state.selection.main
  return from === to ? state.doc.toString() : state.doc.sliceString(from, to)
}

/** What a copy or a cut puts on the clipboard: the markdown exactly as written,
 *  and the same words through the renderer.
 *
 *  Null wherever CodeMirror's own handling is the better one, which is where the
 *  key does not mean "these words": an empty selection, which it copies as a whole
 *  line and remembers doing; several selections at once, which it joins line by
 *  line; and a cut out of a note nothing may be written into. */
export function copiedFlavours(
  state: EditorState,
  cut = false,
): { text: string; html: string } | null {
  const range = state.selection.main
  if (range.empty || state.selection.ranges.length > 1) return null
  if (cut && state.readOnly) return null

  const text = state.doc.sliceString(range.from, range.to)
  return { text, html: renderMarkdown(text) }
}

/** Puts both flavours on the clipboard, and takes the words out for a cut.
 *  Answers false wherever CodeMirror's own handling is the better one. */
function carry(event: ClipboardEvent, view: EditorView, cut: boolean): boolean {
  const data = event.clipboardData
  const flavours = copiedFlavours(view.state, cut)
  if (!data || !flavours) return false

  data.setData('text/plain', flavours.text)
  data.setData('text/html', flavours.html)
  event.preventDefault()

  if (cut) {
    const range = view.state.selection.main
    view.dispatch({
      changes: { from: range.from, to: range.to },
      scrollIntoView: true,
      userEvent: 'delete.cut',
    })
  }

  return true
}

/** Copying markdown out as markdown and as HTML at once. */
export function richCopy(): Extension {
  return EditorView.domEventHandlers({
    copy: (event, view) => carry(event, view, false),
    cut: (event, view) => carry(event, view, true),
  })
}

/** `Ctrl+Shift+C` - the markdown on its own, with no HTML beside it. */
export const copyMarkdown: Command = (view) => {
  navigator.clipboard.writeText(selected(view.state)).catch(() => undefined)
  return true
}
