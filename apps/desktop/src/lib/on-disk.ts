/** Whether anything is at this path: a stamp or a folder, or in the browser,
 *  which keeps no stamps, a note or asset that reads, or a folder's contents. */
import { invoke, isNative } from './tauri'

export async function onDisk(path: string): Promise<boolean> {
  if (isNative) {
    if (await invoke<unknown>('file_stamp', { path }).catch(() => null)) return true
    return invoke('read_tree', { root: path }).then(
      () => true,
      () => false,
    )
  }
  const reads = (command: string, at = path) =>
    invoke<unknown>(command, { path: at }).then(
      (held) => typeof held === 'string',
      () => false,
    )
  if ((await reads('read_note')) || (await reads('read_asset'))) return true
  const options = { showHidden: true, papers: true, every: true }
  const listed = await invoke<{ children?: unknown[] }>('read_tree', { root: path, options })
    .then((tree) => tree.children?.length ?? 0)
    .catch(() => 0)
  return listed > 0 || reads('read_note', `${path}/.keep`)
}
