import { scanRows, type Stamp } from '@orden/bases/scan'
import { isCanvasTarget, isWebTarget } from '@orden/markdown/links'
import { scanCanvas } from './scan-canvas'
import { scanNote, scanShortcut } from './scan-note'
import type { IndexedNote } from './wire'

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

export function indexed(path: string, content: string, stamp: Stamp): IndexedNote | null {
  if (MARKDOWN.test(path)) return { ...scanNote(path, content), ...scanRows(content), stamp }
  if (isCanvasTarget(path)) return scanCanvas(path, content)
  if (isWebTarget(path)) return scanShortcut(path, content)
  return null
}

export function rehomed(scan: IndexedNote, path: string): IndexedNote {
  if (scan.path === path) return scan
  const file = path.split('/').pop() ?? path
  return { ...scan, path, name: MARKDOWN.test(path) ? file.replace(MARKDOWN, '') : file }
}

export function unread(path: string, stamp: Stamp): IndexedNote | null {
  const blank = indexed(path, '', stamp)
  return blank ? { ...blank, bare: false } : null
}
