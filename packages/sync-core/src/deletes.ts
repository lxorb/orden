import { isPagesTarget } from '@orden/markdown/links'
import { kindOfName } from './tree'

export function syncDeletes(path: string, kind: 'file' | 'folder'): boolean {
  if (kind === 'folder' || isPagesTarget(path)) return false
  return kindOfName(path) !== 'file'
}
