/** A kept space's folder on a desktop (internal/folder.ts): its files' bytes and its
 *  index, as files the crate reads and writes, inside the spaces folder where the
 *  crate's file commands reach and outside every space - hidden, so the folder holds
 *  nothing a listing of it shows but the space's root (internal/spaces.ts). Every path
 *  here is a real file's, asked of the crate itself. */

import { toBase64 } from '../bytes'
import { invoke } from '../native'
import { joinPath } from '../tauri'
import type { InternalBytes } from './folder'

export function folderBytes(folder: string): InternalBytes {
  const at = (key: string) => joinPath(folder, `.entries/${key}`)
  const slot = (one: 0 | 1) => joinPath(folder, `.index.${String(one)}.json`)
  return {
    readText: (key) => invoke<string>('read_note', { path: at(key) }).catch(() => null),
    writeText: (key, text) => invoke<undefined>('write_note', { path: at(key), content: text }),
    read: (key) =>
      invoke<ArrayBuffer>('read_file', { path: at(key) }).then(
        (bytes) => new Uint8Array(bytes),
        () => null,
      ),
    write: (key, bytes) =>
      invoke<undefined>('write_bytes', { path: at(key), base64: toBase64(bytes) }),
    remove: (key) => invoke<undefined>('delete_note', { path: at(key) }),
    slot: (one) => invoke<string>('read_note', { path: slot(one) }).catch(() => null),
    // Taken away first, so what is written is a new file, which the crate writes whole
    // or not at all; a file there already it writes into.
    async writeSlot(one, text) {
      await invoke('delete_note', { path: slot(one) }).catch(() => undefined)
      await invoke('write_note', { path: slot(one), content: text })
    },
    where: at,
  }
}
