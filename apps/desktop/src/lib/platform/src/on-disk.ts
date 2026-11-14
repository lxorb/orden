import { invoke, isNative } from './tauri'

export async function onDisk(path: string): Promise<boolean> {
  if (isNative) {
    if (await invoke<unknown>('file_stamp', { path }).catch(() => null)) return true
    return invoke<{ is_dir?: boolean } | null>('read_tree', { root: path }).then(
      (tree) => tree?.is_dir === true,
      () => false,
    )
  }
  return (await invoke<unknown>('path_exists', { path }).catch(() => false)) === true
}
