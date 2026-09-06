import { EditorSelection, type Extension } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

let converter: TurndownService | undefined

/** Built lazily: nothing loads it until something rich is actually pasted. */
function turndown(): TurndownService {
  if (converter) return converter

  converter = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  converter.use(gfm)

  // Whatever these contain is code, not prose; turndown would otherwise paste
  // the script body in as text.
  converter.remove(['script', 'style', 'noscript', 'head', 'meta', 'link', 'title'])

  // The GFM plugin emits a single tilde, which this editor's parser reads as
  // subscript. Struck-through text has to come back as `~~`.
  converter.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement: (content) => (content ? `~~${content}~~` : ''),
  })

  // Highlighted text has a markdown form here, so keep it rather than drop it.
  converter.addRule('highlight', {
    filter: ['mark'],
    replacement: (content) => `==${content}==`,
  })

  converter.addRule('underline', {
    filter: ['u'],
    replacement: (content) => `<u>${content}</u>`,
  })

  return converter
}

export function htmlToMarkdown(html: string): string {
  return turndown().turndown(html).trim()
}

/** Spreadsheet cells arrive as tab-separated lines; Typora turns them into a
 *  table, which is nearly always what was meant. */
export function delimitedToTable(text: string): string | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0)
  if (lines.length < 2) return null

  const separator = lines[0].includes('\t')
    ? '\t'
    : lines.every((l) => l.includes(','))
      ? ','
      : null
  if (!separator) return null

  const rows = lines.map((line) => line.split(separator).map((cell) => cell.trim()))
  const columns = rows[0].length
  if (columns < 2 || rows.some((row) => row.length !== columns)) return null

  const escape = (cell: string) => cell.replace(/\|/g, '\\|')
  const render = (row: string[]) => `| ${row.map(escape).join(' | ')} |`

  return [
    render(rows[0]),
    `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    ...rows.slice(1).map(render),
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

      // A spreadsheet puts both on the clipboard; the plain text is the table.
      const table = delimitedToTable(data.getData('text/plain'))
      if (table) {
        event.preventDefault()
        insert(view, table)
        return true
      }

      const html = data.getData('text/html')
      if (!html.trim()) return false

      const markdown = htmlToMarkdown(html)
      if (!markdown) return false

      event.preventDefault()
      insert(view, markdown)
      return true
    },
  })
}

/** `Ctrl+Shift+V` - take the clipboard exactly as it is. */
export const pastePlain: Command = (view) => {
  if (view.state.readOnly) return false

  void navigator.clipboard.readText().then((text) => {
    if (text) insert(view, text)
  })
  return true
}

/** `Ctrl+Shift+C` - the document is markdown, so this is the selection as-is. */
export const copyMarkdown: Command = (view) => {
  const { from, to } = view.state.selection.main
  const text = from === to ? view.state.doc.toString() : view.state.doc.sliceString(from, to)
  void navigator.clipboard.writeText(text)
  return true
}
