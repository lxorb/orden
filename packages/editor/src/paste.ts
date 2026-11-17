import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { rangeWrittenAsIs } from './code'
import { ourOwn } from './copy'
import { fenceLead, fenceNear } from './fence'
import { wordsBesidePicture } from './images'
import { loadLineCommands } from './line-door'
import { enclosingNamed } from './nodes'
import { later } from './shared'

function converter(): Promise<(html: string) => string> {
  return import('@orden/markdown/from-html').then((one) => one.htmlToMarkdown)
}

export function delimitedToTable(text: string): string | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0)
  const [firstLine] = lines
  if (firstLine === undefined || lines.length < 2) return null

  const separator = firstLine.includes('\t')
    ? '\t'
    : lines.every((line) => line.split(',').length > 2)
      ? ','
      : null
  if (!separator || lines.every((line) => line.startsWith(separator))) return null

  const rows = lines.map((line) => line.split(separator).map((cell) => cell.trim()))
  const [header = [], ...body] = rows
  const columns = header.length
  if (columns < 2 || rows.some((row) => row.length !== columns)) return null
  if (
    separator === ',' &&
    lines.some((line) => /,\s/.test(line)) &&
    (lines.some((line) => /[.!?]$/.test(line.trimEnd())) ||
      !rows.flat().some((cell) => /^[\d$€£%.,+-]+$/.test(cell)))
  ) {
    return null
  }

  const escape = (cell: string) => cell.replace(/\|/g, '\\|')
  const render = (row: string[]) => `| ${row.map(escape).join(' | ')} |`

  return [
    render(header),
    `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    ...body.map(render),
  ].join('\n')
}

function copiedHere(html: string, text: string): string | null {
  return text && ourOwn(html) ? text : null
}

export interface Landing {
  changes: ChangeSpec
  range: SelectionRange
}

export function withLineFeeds(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function plainAt(range: SelectionRange, written: string): Landing {
  const text = withLineFeeds(written)
  return {
    changes: { from: range.from, to: range.to, insert: text },
    range: EditorSelection.cursor(range.from + text.length),
  }
}

export function everywhere(
  state: EditorState,
  land: (range: SelectionRange) => Landing,
): TransactionSpec {
  return { ...state.changeByRange(land), scrollIntoView: true, userEvent: 'input.paste' }
}

function inserted(state: EditorState, text: string): TransactionSpec {
  return everywhere(state, (range) => plainAt(range, text))
}

function codeLead(state: EditorState, range: SelectionRange): string {
  const block =
    fenceNear(state, range.from) ??
    enclosingNamed(syntaxTree(state).resolveInner(range.from, 1), 'BlockMath')
  return block ? fenceLead(state, block) : ''
}

function heldInCode(state: EditorState, text: string): TransactionSpec | null {
  if (!/[\r\n]/.test(text) || state.selection.ranges.every((range) => !codeLead(state, range))) {
    return null
  }
  return everywhere(state, (range) =>
    plainAt(range, text.replace(/\r\n?|\n/g, `\n${codeLead(state, range)}`)),
  )
}

const AN_ITEM = /^(?:[-*+]|\d+[.)])[ \t]/
const EMPTY_ITEM = /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/

function endsAtLineStart(state: EditorState, range: SelectionRange, text: string): boolean {
  if (range.empty || range.to === 0 || /\r?\n$/.test(text)) return false
  return state.doc.lineAt(range.to).from === range.to
}

export const ADDRESS = /^(?:https?:\/\/|mailto:|www\.)[^\s<>]+$/i

const STYLED_BLOCK = /<div\b[^>]*\bstyle\s*=\s*(["'])(.*?)\1/gis

const KEPT_SPACES = /(?:^|;)\s*white-space\s*:\s*pre\s*(?:;|$)/i

const MONOSPACED = /(?:^|;)\s*font-family\s*:[^;]*(?:monospace|consolas|menlo|monaco|courier)/i

function fromCodeEditor(html: string): boolean {
  for (const [, , style = ''] of html.matchAll(STYLED_BLOCK)) {
    if (KEPT_SPACES.test(style) && MONOSPACED.test(style)) return true
  }
  return false
}

function longestTicks(code: string): number {
  return [...code.matchAll(/`+/g)].reduce((most, [run]) => Math.max(most, run.length), 0)
}

function fenced(code: string): string {
  const fence = '`'.repeat(Math.max(2, longestTicks(code)) + 1)
  return `${fence}\n${code}\n${fence}`
}

function inlineCode(code: string): string {
  const ticks = '`'.repeat(longestTicks(code) + 1)
  const padded = code.startsWith('`') || code.endsWith('`') ? ` ${code} ` : code
  return `${ticks}${padded}${ticks}`
}

function codeEditorPaste(html: string, text: string): string | null {
  if (!text || !fromCodeEditor(html)) return null
  const code = withLineFeeds(text).replace(/\n+$/, '')
  if (!code.trim()) return null
  return code.includes('\n') ? fenced(code) : inlineCode(code.trim())
}

const LIST_HTML = /mso-list|<(?:ul|ol)\b/i

const TABLE_HTML = /<table\b/i

const LINKED_CELLS = /<t[dh]\b[^>]*>(?:(?!<\/t[dh]>)[\s\S])*<(?:a|code)\b/i

function tablePaste(html: string, text: string): string | null {
  if (TABLE_HTML.test(html) ? LINKED_CELLS.test(html) : LIST_HTML.test(html)) return null
  return delimitedToTable(text)
}

export async function pastedMarkdown(html: string, text: string): Promise<string | null> {
  const ours = copiedHere(html, text)
  if (ours) return ours

  const code = codeEditorPaste(html, text)
  if (code) return code

  const table = tablePaste(html, text)
  if (table) return table

  if (!html.trim()) return null

  const htmlToMarkdown = await converter()
  return htmlToMarkdown(html) || null
}

export function richPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly) return false

      const data = event.clipboardData
      if (!data) return false

      const html = data.getData('text/html')
      const text = data.getData('text/plain')
      if (data.files.length && !wordsBesidePicture(html, text)) return false

      if (ADDRESS.test(text.trim()) && view.state.selection.ranges.some((one) => !one.empty)) {
        event.preventDefault()
        const land = later(view)
        void loadLineCommands().then(({ linkedPaste }) =>
          land((state) => linkedPaste(state, text) ?? inserted(state, text)),
        )
        return true
      }

      if (view.state.selection.ranges.some((range) => rangeWrittenAsIs(view.state, range))) {
        const held = heldInCode(view.state, text)
        if (!held) return false
        event.preventDefault()
        view.dispatch(held)
        return true
      }

      if (
        view.state.selection.ranges.length === 1 &&
        (copiedHere(html, text) || !html.trim()) &&
        AN_ITEM.test(text) &&
        EMPTY_ITEM.test(view.state.doc.lineAt(view.state.selection.main.head).text)
      ) {
        event.preventDefault()
        const land = later(view)
        void loadLineCommands().then(({ plainly }) => land((state) => plainly(state, text)))
        return true
      }

      const ready = copiedHere(html, text) ?? codeEditorPaste(html, text) ?? tablePaste(html, text)
      if (ready) {
        event.preventDefault()
        const land = later(view)
        void loadLineCommands().then(({ placed }) => land((state) => placed(state, ready)))
        return true
      }

      if (!html.trim()) {
        if (
          !view.state.selection.ranges.some((range) => endsAtLineStart(view.state, range, text))
        ) {
          return false
        }
        event.preventDefault()
        const land = later(view)
        void loadLineCommands().then(({ plainly }) => land((state) => plainly(state, text)))
        return true
      }

      event.preventDefault()
      const land = later(view)
      void Promise.all([converter(), loadLineCommands()])
        .then(([htmlToMarkdown, { placed }]) => {
          const words = htmlToMarkdown(html) || text
          if (words) land((state) => placed(state, words))
        })
        .catch(() => {
          if (text) land((state) => inserted(state, text))
        })

      return true
    },
  })
}

export const pasteHere: Command = (view) => {
  if (view.state.readOnly) return false

  const land = later(view)
  void readClipboard()
    .then(async (clipboard) => {
      if (!clipboard) return
      const { linkedPaste, placed, plainly } = await loadLineCommands()
      if (land((state) => linkedPaste(state, clipboard.text))) return

      const inCodeNow = land((state) =>
        state.selection.ranges.some((range) => rangeWrittenAsIs(state, range))
          ? (heldInCode(state, clipboard.text) ?? inserted(state, clipboard.text))
          : null,
      )
      if (inCodeNow) return

      const markdown = await pastedMarkdown(clipboard.html, clipboard.text)
      if (markdown) land((state) => placed(state, markdown))
      else if (clipboard.text) land((state) => plainly(state, clipboard.text))
    })
    .catch(() => undefined)

  return true
}

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

export const pastePlain: Command = (view) => {
  if (view.state.readOnly) return false

  const land = later(view)
  void Promise.all([navigator.clipboard.readText(), loadLineCommands()])
    .then(([text, { plainly }]) => {
      if (text) land((state) => heldInCode(state, text) ?? plainly(state, text))
    })
    .catch(() => undefined)
  return true
}
