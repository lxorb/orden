import { isPagesTarget } from '@orden/markdown/links'
import { kindOfName } from '@orden/sync-core'
import type { FileKind } from './world'

export function syncDeletes(path: string, kind: FileKind): boolean {
  if (kind === 'folder' || isPagesTarget(path)) return false
  return kindOfName(path) !== 'file'
}
