import {
  isBaseTarget,
  isCanvasTarget,
  isChatTarget,
  isTermTarget,
  isPagesTarget,
  isPdfTarget,
  isWebTarget,
} from '@orden/markdown/links'
import { isMarkdownPath } from '../../platform/src/api'

export type Opener = 'pdf' | 'web' | 'pages' | 'canvas' | 'view' | 'chat' | 'term' | 'note'
export function openerFor(path: string, isUrlNote: (path: string) => boolean): Opener | null {
  if (isPdfTarget(path)) return 'pdf'
  if (isWebTarget(path)) return 'web'
  if (isMarkdownPath(path) && isUrlNote(path)) return 'web'
  if (isPagesTarget(path)) return 'pages'
  if (isCanvasTarget(path)) return 'canvas'
  if (isBaseTarget(path)) return 'view'
  if (isChatTarget(path)) return 'chat'
  if (isTermTarget(path)) return 'term'
  return 'note'
}
export function sharedKind(path: string): 'canvas' | 'pages' | 'channel' | 'note' {
  if (isCanvasTarget(path)) return 'canvas'
  if (isPagesTarget(path)) return 'pages'
  return isChatTarget(path) ? 'channel' : 'note'
}
