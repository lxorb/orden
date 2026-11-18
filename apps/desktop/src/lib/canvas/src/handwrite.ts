import { todayOf } from '@orden/bases'
import { blankCanvas } from '@orden/markdown/canvas'
import { formatWikilink } from '@orden/markdown/links'
import type { EditorView } from '@orden/editor'
import { views } from '../../panes/src/api'
import { folderOf, isMarkdownPath, joinPath, nameOf, spaceRelative } from '../../platform/src/api'
import { canWriteAt } from '../../sharing/src/api'
import { storeAttachment, workspace } from '../../workspace/src/api'
import { tools } from './tools.svelte'

const two = (value: number) => String(value).padStart(2, '0')

export function handwritingName(at: Date): string {
  const clock = `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`
  return `handwriting-${todayOf(at)}-${clock}.canvas`
}

export function placedAtCaret(view: EditorView, text: string) {
  const { doc, selection } = view.state
  const range = selection.main
  const line = doc.lineAt(range.from)
  const above = line.number > 1 ? doc.line(line.number - 1).text : ''
  const before = doc.sliceString(line.from, range.from).trim() ? '\n\n' : above.trim() ? '\n' : ''
  const end = doc.lineAt(range.to)
  const below = end.number < doc.lines ? doc.line(end.number + 1).text : null
  const roomBelow = !doc.sliceString(range.to, end.to).trim() && below !== null && !below.trim()
  const insert = `${before}${text}${roomBelow ? '\n' : '\n\n'}`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length + (roomBelow ? end.to - range.to + 1 : 0) },
    scrollIntoView: true,
    userEvent: 'input',
  })
}

export async function handwrite(): Promise<void> {
  const tab = workspace.active
  if (tab?.kind !== 'note') return
  const view = views.of(tab.paneId)
  if (!view || view.state.readOnly) return

  const path = tab.path ?? (await workspace.save(tab))
  if (!path || !isMarkdownPath(path) || !canWriteAt(path)) return

  const file = new File([blankCanvas()], handwritingName(new Date()), { type: 'application/json' })
  const written = await storeAttachment(file, path)
  if (!written) return

  placedAtCaret(
    view,
    formatWikilink({
      target: nameOf(written),
      heading: null,
      block: null,
      alias: null,
      embed: true,
    }),
  )
  const root = workspace.rootHolding(path)
  const inSpace = root === null ? null : spaceRelative(root, path, written)
  tools.choose('draw')
  await workspace.openCanvas(
    root !== null && inSpace ? joinPath(root, inSpace) : joinPath(folderOf(path), written),
  )
}
