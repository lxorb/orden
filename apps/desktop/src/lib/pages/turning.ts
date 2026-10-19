/** What turning a PDF into its page note does to a space on this platform: the reads,
 *  the write and the questions of pages/from-pdf.ts, answered by the app's own
 *  commands. The move is the workspace's, the rename every file operation is, so the
 *  links, tabs and stores kept by path follow the paper; it is handed in.
 *
 *  Fetched with the first PDF opened or brought in, and not before. */

import { pageSizes } from '../pdf/document'
import { invoke, isNative } from '../tauri'
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

/** Whether a file is at this path on the disk, whatever the list shows: the list
 *  leaves out a paper a page note holds. `file_stamp` answers nothing where there is
 *  none; the browser keeps no stamps (web/commands.ts), so there a note is there if it
 *  reads, and a PDF if its bytes do. */
async function onDisk(path: string): Promise<boolean> {
  if (isNative) {
    const stamp = await invoke<unknown>('file_stamp', { path }).catch(() => null)
    return stamp !== null && stamp !== undefined
  }
  const reads = (command: string) =>
    invoke<unknown>(command, { path }).then(
      (held) => typeof held === 'string',
      () => false,
    )
  return (await reads('read_note')) || (await reads('read_asset'))
}
