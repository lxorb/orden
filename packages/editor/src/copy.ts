import type { EditorState, Extension } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { door } from '@orden/markdown/door'

const OURS = 'data-nib="markdown"'

let render: ((source: string) => string) | null = null

const fetchRenderer = door(async () => {
  render = (await import('@orden/markdown')).renderMarkdown
})

export function readyToCopy(): Promise<void> {
  return fetchRenderer()
}

function selected(state: EditorState): string {
  const { from, to } = state.selection.main
  return from === to ? state.doc.toString() : state.doc.sliceString(from, to)
}

export function ourOwn(html: string): boolean {
  return html.includes(OURS)
}

export function copiedFlavours(
  state: EditorState,
  cut = false,
): { text: string; html: string | null } | null {
  const range = state.selection.main
  if (range.empty || state.selection.ranges.length > 1) return null
  if (cut && state.readOnly) return null

  const text = state.doc.sliceString(range.from, range.to)
  if (!render) void fetchRenderer()
  return { text, html: render ? `<div ${OURS}>${render(text)}</div>` : null }
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

export function richCopy(): Extension {
  return [
    EditorView.domEventHandlers({
      copy: (event, view) => carry(event, view, false),
      cut: (event, view) => carry(event, view, true),
    }),
    EditorView.updateListener.of((update) => {
      if (!render && update.selectionSet && !update.state.selection.main.empty) void fetchRenderer()
    }),
  ]
}

export const copyMarkdown: Command = (view) => {
  navigator.clipboard.writeText(selected(view.state)).catch(() => undefined)
  return true
}
