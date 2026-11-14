import {
  isApplicationTarget,
  isBaseTarget,
  isCanvasTarget,
  isChatTarget,
  isTermTarget,
  isPagesTarget,
  isPdfTarget,
  isWebTarget,
} from '@orden/markdown/links'
import { isMarkdownPath } from './platform/src/api'

export type Opener =
  'pdf' | 'web' | 'pages' | 'canvas' | 'view' | 'chat' | 'term' | 'application' | 'note'

export interface Build {
  evenBuild: boolean
  isPlugin: boolean
}

export function openerFor(
  path: string,
  isUrlNote: (path: string) => boolean,
  build: Build,
): Opener | null {
  if (isPdfTarget(path)) return build.evenBuild ? null : 'pdf'
  if (isWebTarget(path)) return 'web'
  if (isMarkdownPath(path) && isUrlNote(path)) return 'web'
  if (isPagesTarget(path)) return build.isPlugin ? null : 'pages'
  if (isCanvasTarget(path)) return build.isPlugin ? null : 'canvas'
  if (isBaseTarget(path)) return build.isPlugin ? null : 'view'
  if (isChatTarget(path)) return build.isPlugin ? null : 'chat'
  if (isTermTarget(path)) return build.isPlugin ? null : 'term'
  if (isApplicationTarget(path)) return build.isPlugin ? null : 'application'

  return 'note'
}

export function sharedKind(path: string): 'canvas' | 'pages' | 'channel' | 'note' {
  if (isCanvasTarget(path)) return 'canvas'
  if (isPagesTarget(path)) return 'pages'
  return isChatTarget(path) ? 'channel' : 'note'
}
