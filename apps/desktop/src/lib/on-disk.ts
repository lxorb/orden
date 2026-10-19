/** Whether a file is at this path on the disk, whatever the list shows.
 *
 *  The crate's `file_stamp` answers nothing where there is none. The browser keeps no
 *  stamps (web/commands.ts answers null for every path), so there a file is there if
 *  it reads: a note's words, or a picture's or a PDF's bytes. Asked before writing
 *  under a name that may be taken, which in the browser used to read as free every
 *  time, and the write went over the note already there. */
import { invoke, isNative } from './tauri'

export async function onDisk(path: string): Promise<boolean> {
  if (isNative) {
    // A stamp is an object; nothing, or an empty answer, is no file.
    return Boolean(await invoke<unknown>('file_stamp', { path }).catch(() => null))
  }
  const reads = (command: string) =>
    invoke<unknown>(command, { path }).then(
      (held) => typeof held === 'string',
      () => false,
    )
  return (await reads('read_note')) || (await reads('read_asset'))
}
