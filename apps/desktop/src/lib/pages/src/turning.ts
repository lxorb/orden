import { lentMoved, pageSizes, warmPdf } from '../../pdf/src/api'
import { onDisk, invoke } from '../../platform/src/api'
import { writeFile } from '../../workspace/write-file'
import type { Turning } from './from-pdf'

export function turningIn(
  root: string | null,
  move: (from: string, to: string) => Promise<void>,
): Turning {
  warmPdf()
  return {
    root,
    exists: onDisk,
    read: (path) => invoke<string>('read_note', { path }).catch(() => null),
    write: writeFile,
    move: async (from, to) => {
      await move(from, to)
      lentMoved(from, to)
    },
    discard: (path) => invoke('delete_note', { path }),
    sizes: pageSizes,
  }
}
