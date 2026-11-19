import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { door } from '@orden/markdown/door'
import { escapeAll } from '@orden/markdown/html'
import { enclosingNamed } from './nodes'

const OURS = 'data-orden="markdown"'
export const MOST_DRAWN = 256 * 1024
let render: ((source: string) => string) | null = null
const fetchRenderer = door(async () => {
  render = (await import('@orden/markdown')).renderMarkdown
})
export const readyToCopy = (): Promise<void> => fetchRenderer()
function selected(state: EditorState): string {
  const { from, to } = state.selection.main
  return from === to ? state.doc.toString() : state.doc.sliceString(from, to)
}
export const ourOwn = (html: string): boolean => html.includes(OURS)
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock'])
function codeWords(state: EditorState, code: SyntaxNode): { from: number; to: number } {
  if (code.name === 'CodeBlock') return code
  const marks = code.getChildren('CodeMark')
  if (code.name === 'InlineCode') {
    return { from: marks[0]?.to ?? code.to, to: marks[1]?.from ?? code.from }
  }
  const close = marks.length > 1 ? marks[marks.length - 1] : undefined
  return {
    from: state.doc.lineAt(code.from).to + 1,
    to: close ? state.doc.lineAt(close.from).from : code.to,
  }
}
function drawnAsCode(state: EditorState, from: number, to: number): string | null {
  const code = enclosingNamed(syntaxTree(state).resolveInner(from, 1), CODE)
  if (!code) return null
  const words = codeWords(state, code)
  if (from < words.from || to > words.to) return null
  const text = escapeAll(state.doc.sliceString(from, to))
  if (code.name === 'InlineCode') return `<code>${text}</code>`
  const info = code.getChild('CodeInfo')
  const language = info ? state.doc.sliceString(info.from, info.to).split(/\s/)[0] : ''
  const named = language ? ` class="language-${escapeAll(language)}"` : ''
  return `<pre><code${named}>${text}</code></pre>`
}
const RUNS = new Set(['StrongEmphasis', 'Emphasis', 'InlineCode', 'Link', 'Strikethrough', 'Highlight', 'Wikilink'])
function marksOf(node: SyntaxNode): SyntaxNode[] {
  const marks: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name.endsWith('Mark')) marks.push(child)
  }
  return marks
}
function closedRuns(state: EditorState, from: number, to: number): string {
  const tree = syntaxTree(state)
  let before = ''
  let after = ''
  for (let node: SyntaxNode | null = tree.resolveInner(from, 1); node; node = node.parent) {
    if (!RUNS.has(node.name) || node.from >= from || node.to > to) continue
    const [opener, next] = marksOf(node)
    if (opener && opener.to <= from && (!next || next.from >= from))
      before = state.doc.sliceString(node.from, opener.to) + before
  }
  for (let node: SyntaxNode | null = tree.resolveInner(to, -1); node; node = node.parent) {
    if (!RUNS.has(node.name) || node.to <= to || node.from < from) continue
    const closer = marksOf(node).find((mark) => mark.from >= to)
    if (closer) after += state.doc.sliceString(closer.from, node.to)
  }
  return before + state.doc.sliceString(from, to) + after
}
export function copiedFlavours(state: EditorState, cut = false): { text: string; html: string | null } | null {
  const range = state.selection.main
  if (range.empty || state.selection.ranges.length > 1) return null
  if (cut && state.readOnly) return null
  const text = state.doc.sliceString(range.from, range.to)
  if (text.length > MOST_DRAWN) return { text, html: null }
  const code = drawnAsCode(state, range.from, range.to)
  if (code) return { text, html: `<div ${OURS}>${code}</div>` }
  if (!render) void fetchRenderer()
  const drawn = render?.(closedRuns(state, range.from, range.to))
  return { text, html: drawn === undefined ? null : `<div ${OURS}>${drawn}</div>` }
}
function carry(event: ClipboardEvent, view: EditorView, cut: boolean): boolean {
  const data = event.clipboardData
  const flavours = copiedFlavours(view.state, cut)
  if (!data || !flavours) return false
  data.setData('text/plain', flavours.text)
  if (flavours.html !== null) data.setData('text/html', flavours.html)
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
export const richCopy = (): Extension => [
  EditorView.domEventHandlers({
    copy: (event, view) => carry(event, view, false),
    cut: (event, view) => carry(event, view, true),
  }),
  EditorView.updateListener.of((update) => {
    if (!render && update.selectionSet && !update.state.selection.main.empty) void fetchRenderer()
  }),
]
export const copyMarkdown: Command = (view) => {
  navigator.clipboard.writeText(selected(view.state)).catch(() => undefined)
  return true
}
