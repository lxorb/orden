import { isPagesTarget } from '@orden/markdown/links'
import { kindOfName } from '@orden/sync-core/tree'
import type { FileKind } from '../sync2/world'

export function syncDeletes(path: string, kind: FileKind): boolean {
  if (kind === 'folder' || isPagesTarget(path)) return false
  return kindOfName(path) !== 'file'
}
