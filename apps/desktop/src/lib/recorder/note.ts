import type { EditorView } from '@orden/editor'
import { canWriteAt } from '../sharing.svelte'
import { isMarkdownPath } from '../space-paths'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { recordingNoteName } from './transcript'

export function viewFor(path: string): EditorView | null {
  for (const tab of workspace.tabs) {
    if (tab.note.path !== path) continue

    const view = views.of(tab.paneId)
    if (view) return view
  }

  return null
}

export function writeAtCaret(view: EditorView, text: string) {
  const range = view.state.selection.main
  const line = view.state.doc.lineAt(range.from)

  const before = range.from === line.from ? '' : '\n'
  const after = range.to === line.to ? '' : '\n'
  const insert = `${before}${text}${after}`

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + before.length + text.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

export function appendTo(path: string, text: string): boolean {
  const view = viewFor(path)
  if (!view || view.state.readOnly) return false

  const end = view.state.doc.length
  view.dispatch({ changes: { from: end, to: end, insert: text }, userEvent: 'input.complete' })
  return true
}

export function mayRecordInto(path: string): boolean {
  return canWriteAt(path) && viewFor(path)?.state.readOnly !== true
}

export async function noteToRecordInto(): Promise<string | null> {
  const open = workspace.active
  if (open?.kind === 'note' && open.path && isMarkdownPath(open.path)) {
    return mayRecordInto(open.path) ? open.path : null
  }

  if (!workspace.activeSpace || !canWriteAt(workspace.activeSpace.root)) return null

  await workspace.createNote(undefined, `${recordingNoteName(new Date())}.md`)
  return workspace.active?.path ?? null
}
