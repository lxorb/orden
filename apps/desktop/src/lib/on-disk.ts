/** Whether anything is at this path: a stamp or a folder, or in the browser, which
 *  keeps no stamps, the listing's own answer (`path_exists`, web/commands.ts). */
import { invoke, isNative } from './tauri'

export async function onDisk(path: string): Promise<boolean> {
  if (isNative) {
    if (await invoke<unknown>('file_stamp', { path }).catch(() => null)) return true
    return invoke('read_tree', { root: path }).then(
      () => true,
      () => false,
    )
  }
  return (await invoke<unknown>('path_exists', { path }).catch(() => false)) === true
}
