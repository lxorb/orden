import {
  isApplicationTarget,
  isBaseTarget,
  isCanvasTarget,
  isChatTarget,
  isTermTarget,
  isImageTarget,
  isPagesTarget,
  isPdfTarget,
  isWebTarget,
} from '@orden/markdown/links'
import type { IconNode } from 'lucide'
import File from 'lucide/dist/esm/icons/file.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import Folder from 'lucide/dist/esm/icons/folder.mjs'
import Globe from 'lucide/dist/esm/icons/globe.mjs'
import Image from 'lucide/dist/esm/icons/image.mjs'
import MessageSquare from 'lucide/dist/esm/icons/message-square.mjs'
import NotebookPen from 'lucide/dist/esm/icons/notebook-pen.mjs'
import Server from 'lucide/dist/esm/icons/server.mjs'
import SquareTerminal from 'lucide/dist/esm/icons/square-terminal.mjs'
import Table from 'lucide/dist/esm/icons/table-2.mjs'
import { isMarkdownPath } from './space-paths'
import { type TabKind, TAB_KINDS } from './workspace/tab-kinds'

const Workflow: IconNode = [
  ['rect', { width: '9', height: '9', x: '2', y: '2', rx: '2.25' }],
  ['path', { d: 'M6.5 11v4.25a2.25 2.25 0 0 0 2.25 2.25H13' }],
  ['rect', { width: '9', height: '9', x: '13', y: '13', rx: '2.25' }],
]

const Key: IconNode = [
  ['circle', { cx: '8', cy: '16', r: '6' }],
  ['path', { d: 'm12.25 11.75 9.75-9.75' }],
  ['path', { d: 'm19 5 3 3' }],
  ['path', { d: 'm16 8 2 2' }],
]

const Window: IconNode = [
  ['rect', { width: '18', height: '20', x: '3', y: '2', rx: '2' }],
  ['path', { d: 'M3 9h18' }],
]

const PAGE_TOP: IconNode = [
  [
    'path',
    {
      d: 'M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v3',
    },
  ],
  ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
]

function typeMark(letters: IconNode): IconNode {
  return [...PAGE_TOP, ...letters]
}

const Pdf: IconNode = typeMark([
  ['path', { d: 'M3 21v-7h2a2 2 0 0 1 0 4H3' }],
  ['path', { d: 'M10 14v7h1a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3z' }],
  ['path', { d: 'M21 14h-4v7' }],
  ['path', { d: 'M17 17.5h3' }],
])

export type FileMark =
  | 'note'
  | 'folder'
  | 'canvas'
  | 'pages'
  | 'pdf'
  | 'picture'
  | 'file'
  | 'web'
  | 'terminal'
  | 'remote'
  | 'base'
  | 'chat'
  | 'application'
  | 'key'

export function fileMark(name: string): FileMark {
  if (isWebTarget(name)) return 'web'
  if (isCanvasTarget(name)) return 'canvas'
  if (isPagesTarget(name)) return 'pages'
  if (isPdfTarget(name)) return 'pdf'
  if (isBaseTarget(name)) return 'base'
  if (isChatTarget(name)) return 'chat'
  if (isTermTarget(name)) return 'terminal'
  if (isApplicationTarget(name)) return 'application'
  if (isImageTarget(name)) return 'picture'
  if (isMarkdownPath(name)) return 'note'
  return 'file'
}

export function markOf(kind: TabKind): FileMark | null {
  return TAB_KINDS[kind].mark
}

export const MARKS: Record<FileMark, IconNode> = {
  note: FileText,
  folder: Folder,
  canvas: Workflow,
  pages: NotebookPen,
  pdf: Pdf,
  picture: Image,
  file: File,
  web: Globe,
  terminal: SquareTerminal,
  remote: Server,
  base: Table,
  chat: MessageSquare,
  application: Window,
  key: Key,
}

export function faceOf(mark: FileMark, chosen: boolean): 'mark' | 'letter' {
  return mark === 'note' && !chosen ? 'letter' : 'mark'
}

const GRAPHEMES = new Intl.Segmenter()

export function initialOf(name: string): string {
  let first: string | null = null

  for (const { segment } of GRAPHEMES.segment(name.trim())) {
    first ??= segment
    if (/[\p{L}\p{N}]/u.test(segment)) return segment.toLocaleUpperCase()
  }

  return first ?? ''
}
