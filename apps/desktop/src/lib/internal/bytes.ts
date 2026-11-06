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
    async writeSlot(one, text) {
      await invoke('delete_note', { path: slot(one) }).catch(() => undefined)
      await invoke('write_note', { path: slot(one), content: text })
    },
    where: at,
  }
}
