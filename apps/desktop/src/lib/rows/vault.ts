import { invoke, joinPath } from '../tauri'

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
