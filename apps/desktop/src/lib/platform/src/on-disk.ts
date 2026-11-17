import { invoke, isNative, joinPath } from './tauri'

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

const SETTINGS = ['app.json', 'workspace.json', 'core-plugins.json']

const asked = new Map<string, Promise<boolean>>()

export function isVault(root: string): Promise<boolean> {
  let found = asked.get(root)
  if (!found) {
    found = Promise.all(
      SETTINGS.map((name) =>
        invoke<unknown>('file_stamp', { path: joinPath(root, `.obsidian/${name}`) }).catch(
          () => null,
        ),
      ),
    ).then((stamps) => stamps.some((stamp) => stamp !== null && stamp !== undefined))
    asked.set(root, found)
  }
  return found
}
