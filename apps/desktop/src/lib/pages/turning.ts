import { pageSizes } from '../pdf/document'
import { onDisk } from '../on-disk'
import { invoke } from '../tauri'
import { writeFile } from '../workspace/write-file'
import type { Turning } from './from-pdf'

export function turningIn(
  root: string | null,
  move: (from: string, to: string) => Promise<void>,
): Turning {
  return {
    root,
    exists: onDisk,
    read: (path) => invoke<string>('read_note', { path }).catch(() => null),
    write: writeFile,
    move,
    discard: (path) => invoke('delete_note', { path }),
    sizes: pageSizes,
  }
}
