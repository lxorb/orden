import { type Canvas, readCanvas, writeCanvas } from '@orden/markdown/canvas'
import { fileBytes, log, nameFromTitle, nameOf, samePath, spaceHolding } from '../../platform/src/api'
import { writeBytes } from '../../file-writes/src/api'
import { CanvasStore } from '../../canvas/src/api'
import { paperOf } from '@orden/markdown/pages'
import { pageSizes } from '../../pdf/src/api'
import { type NoteDoc, type Tab, UNTITLED, isDraft } from '../../documents/src/api'
import { notices } from '../../workspace/src/api'
import { asDraft, paperNamed, paperOutside } from './from-pdf'

export interface Drafts {
  readonly tabs: Tab[]
  readonly spaces: readonly { root: string }[]
  openUnsaved(kind: 'pages', text: string, name: string): Tab
}
const inSomeSpace = (ws: Drafts) => (path: string) => spaceHolding(ws.spaces, path) !== null
const draftOf = (ws: Drafts, from: string) =>
  ws.tabs.find((tab) => {
    if (tab.kind !== 'pages' || !isDraft(tab.note)) return false
    const paper = paperOutside(tab.note.text, inSomeSpace(ws))
    return paper !== null && samePath(paper, from)
  })
export async function draftPdf(ws: Drafts, from: string): Promise<Tab | null> {
  const open = draftOf(ws, from)
  if (open) return open
  const text = await asDraft(from, pageSizes).catch((error: unknown) => {
    log('error', `open PDF as a draft: ${from} - ${String(error)}`)
    return null
  })
  const opened = draftOf(ws, from)
  if (opened) return opened
  if (text === null) {
    const { unread } = await notices()
    await unread.there(from)
    return null
  }
  ws.openUnsaved('pages', text, nameFromTitle(nameOf(from).replace(/\.pdf$/i, '')) ?? UNTITLED)
  return null
}
export async function keepPaper(ws: Drafts, note: NoteDoc, path: string): Promise<void> {
  const from = paperOutside(note.text, inSomeSpace(ws))
  if (!from) return
  try {
    const paper = paperOf(path)
    await writeBytes(paper, await fileBytes(from))
    const named = (plane: Canvas) => paperNamed(plane, from, nameOf(paper))
    const drawing = CanvasStore.drawing(note, ws.tabs)
    if (drawing) drawing.relinked(named)
    else note.replace(writeCanvas(named(readCanvas(note.text))))
  } catch (error) {
    log('warn', `keep the paper of ${path}: ${from} - ${String(error)}`)
  }
}
