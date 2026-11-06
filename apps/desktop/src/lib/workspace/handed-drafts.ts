import { type Canvas, readCanvas, writeCanvas } from '@orden/markdown/canvas'
import { fileBytes, toBase64 } from '../bytes'
import { CanvasStore } from '../canvas/store.svelte'
import { log } from '../log'
import { nameFromTitle } from '../note-name'
import { asDraft, paperNamed, paperOutside } from '../pages/from-pdf'
import { paperOf } from '../pages/held'
import { pageSizes } from '../pdf/document'
import { nameOf, samePath, within } from '../space-paths'
import { invoke } from '../tauri'
import { type NoteDoc, type Tab, UNTITLED } from './documents.svelte'
import { isDraft } from './drafts'

export interface Drafts {
  readonly tabs: Tab[]
  readonly spaces: readonly { root: string }[]
  openUnsaved(kind: 'pages', text: string, name: string): Tab
}

const inSomeSpace = (ws: Drafts) => (path: string) =>
  ws.spaces.some((one) => within(one.root, path) !== null)

export async function draftPdf(ws: Drafts, from: string): Promise<Tab | null> {
  const open = ws.tabs.find((tab) => {
    if (tab.kind !== 'pages' || !isDraft(tab.note)) return false
    const paper = paperOutside(tab.note.text, inSomeSpace(ws))
    return paper !== null && samePath(paper, from)
  })
  if (open) return open

  const text = await asDraft(from, pageSizes).catch((error: unknown) => {
    log('error', `open PDF as a draft: ${from} - ${String(error)}`)
    return null
  })
  if (text === null) {
    const { unread } = await import('../unread.svelte')
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
    await invoke('write_bytes', { path: paper, base64: toBase64(await fileBytes(from)) })
    const named = (plane: Canvas) => paperNamed(plane, from, nameOf(paper))
    const drawing = CanvasStore.drawing(note, ws.tabs)
    if (drawing) drawing.relinked(named)
    else note.replace(writeCanvas(named(readCanvas(note.text))))
  } catch (error) {
    log('warn', `keep the paper of ${path}: ${from} - ${String(error)}`)
  }
}
