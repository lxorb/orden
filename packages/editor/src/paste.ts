import { EditorSelection, type Extension } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { htmlToMarkdown } from '@nib/markdown/from-html'

/** Spreadsheet cells arrive as tab-separated lines; Typora turns them into a
 *  table, which is nearly always what was meant. */
export function delimitedToTable(text: string): string | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0)
  const [firstLine] = lines
  if (firstLine === undefined || lines.length < 2) return null

  // A tab on the first line settles it: nothing but a spreadsheet puts tabs on
  // the clipboard. A comma has to be on every line *twice* - `Hello, world` and
  // `Goodbye, world` are two sentences, and one comma each was enough to turn
  // them into a two-column table.
  const separator = firstLine.includes('\t')
    ? '\t'
    : lines.every((line) => line.split(',').length > 2)
      ? ','
      : null
  if (!separator) return null

  const rows = lines.map((line) => line.split(separator).map((cell) => cell.trim()))
  // An empty header falls out below on the column count, so the default needs
  // no check of its own.
  const [header = [], ...body] = rows
  const columns = header.length
  if (columns < 2 || rows.some((row) => row.length !== columns)) return null

  const escape = (cell: string) => cell.replace(/\|/g, '\\|')
  const render = (row: string[]) => `| ${row.map(escape).join(' | ')} |`

  return [
    render(header),
    `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    ...body.map(render),
  ].join('\n')
}

function insert(view: EditorView, text: string) {
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.cursor(range.from + text.length),
    scrollIntoView: true,
    userEvent: 'input.paste',
  })
}

/** What a clipboard's two flavours come to, as markdown. Null where there is
 *  nothing worth inserting, which leaves the paste to whoever asked. */
export function pastedMarkdown(html: string, text: string): string | null {
  // A spreadsheet puts both on the clipboard; the plain text is the table.
  const table = delimitedToTable(text)
  if (table) return table

  if (!html.trim()) return null
  return htmlToMarkdown(html) || null
}

/** Pasting a web page gives markdown, the way Typora does it. */
export function richPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      // Handed back to CodeMirror, which refuses it too while the document is
      // read-only. Turning a web page into markdown first would be work done
      // for a change that is not going to land.
      if (view.state.readOnly) return false

      const data = event.clipboardData
      if (!data || data.files.length) return false

      const markdown = pastedMarkdown(data.getData('text/html'), data.getData('text/plain'))
      if (markdown === null) return false

      event.preventDefault()
      insert(view, markdown)
      return true
    },
  })
}

/** The Paste row in the menu, which has no paste event to ride on.
 *
 *  `Ctrl+V` never comes through here: the browser raises a paste event and
 *  `richPaste` above answers it, which is the only way to see a picture on the
 *  clipboard at all. A menu row has to go and ask instead, and asking gives the
 *  same two flavours read the same way, so a page pasted from the menu is the
 *  page pasted with the keyboard.
 *
 *  A clipboard the browser will not hand over - no permission, or not a secure
 *  context - pastes nothing, and says so by pasting nothing. */
export const pasteHere: Command = (view) => {
  if (view.state.readOnly) return false

  void readClipboard()
    .then((clipboard) => {
      if (!clipboard) return
      const markdown = pastedMarkdown(clipboard.html, clipboard.text)
      const text = markdown ?? clipboard.text
      if (text) insert(view, text)
    })
    .catch(() => undefined)

  return true
}

/** The clipboard's HTML and its text, as far as this browser will say.
 *
 *  `read` is the one that sees HTML and the one a webview is most likely to
 *  refuse; `readText` is the fallback, and a paste of plain text is a great deal
 *  better than a paste of nothing. */
async function readClipboard(): Promise<{ html: string; text: string } | null> {
  try {
    const items = await navigator.clipboard.read()
    let html = ''
    let text = ''

    for (const item of items) {
      if (!html && item.types.includes('text/html'))
        html = await (await item.getType('text/html')).text()
      if (!text && item.types.includes('text/plain'))
        text = await (await item.getType('text/plain')).text()
    }

    if (html || text) return { html, text }
  } catch {
    // Fall through to the text below, which some webviews allow when `read` is
    // refused outright.
  }

  const text = await navigator.clipboard.readText().catch(() => '')
  return text ? { html: '', text } : null
}

/** `Ctrl+Shift+V` - take the clipboard exactly as it is.
 *
 *  A clipboard the browser will not hand over - no permission, or not a secure
 *  context - pastes nothing, and says so by pasting nothing. The rejection is
 *  caught rather than dropped: nothing else would answer for it, and an
 *  unhandled one is noise at best. */
export const pastePlain: Command = (view) => {
  if (view.state.readOnly) return false

  navigator.clipboard
    .readText()
    .then((text) => {
      if (text) insert(view, text)
    })
    .catch(() => undefined)
  return true
}
