/** A kept space's folder on a desktop (internal/folder.ts): its files' bytes and its
 *  index, as files the crate reads and writes, inside the spaces folder where the
 *  crate's file commands reach and outside every space. Every path here is a real
 *  file's, so none of these calls is one a kept space answers itself. */

import { fileBytes, toBase64 } from '../bytes'
import { invoke, joinPath } from '../tauri'
import type { InternalBytes } from './folder'

export function folderBytes(folder: string): InternalBytes {
  const at = (key: string) => joinPath(folder, `entries/${key}`)
  const slot = (one: 0 | 1) => joinPath(folder, `index.${String(one)}.json`)
  return {
    readText: (key) => invoke<string>('read_note', { path: at(key) }).catch(() => null),
    writeText: (key, text) => invoke<undefined>('write_note', { path: at(key), content: text }),
    read: (key) => fileBytes(at(key)).catch(() => null),
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
