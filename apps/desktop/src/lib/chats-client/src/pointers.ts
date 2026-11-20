import type { Entry } from '@orden/contracts'
import { CHAT_EXTENSION, chatOf, chatText } from '@orden/chats'
import { nameOf, shownName, spaceHolding, invoke, joinPath } from '../../platform/src/api'
import { sync } from '../../sync-store/src/api'
import { workspace } from '../../workspace/src/api'
import { writeFile } from '../../file-writes/src/api'
import { makeChat } from './http'

export interface Place {
  root: string
  path: string
}
export function chatName(path: string): string {
  return shownName(nameOf(path))
}
export async function makePointer(folder: string, name: string): Promise<Place | null> {
  const space = spaceHolding(workspace.spaces, folder)
  const remote = space ? sync.remoteIdFor(space.root) : null
  if (!space || !remote) return null
  const pointer = await makeChat(remote)
  if (!pointer) return null
  const path = joinPath(folder, await workspace.freeNameOnDisk(folder, `${name}${CHAT_EXTENSION}`))
  const text = chatText(pointer)
  await writeFile(path, text)
  await workspace.fileCame(path, 'file')
  sync.wrote(path, text)
  void sync.pass().catch(() => false)
  return { root: space.root, path }
}
export async function readPointer(path: string): Promise<string | null> {
  if (!path.toLowerCase().endsWith(CHAT_EXTENSION)) return null
  const text = await invoke<string>('read_note', { path }).catch(() => null)
  return text === null ? null : (chatOf(text)?.chat ?? null)
}
function pointerPaths(entry: Entry, out: string[]): string[] {
  for (const child of entry.children) {
    if (child.is_dir) pointerPaths(child, out)
    else if (child.name.toLowerCase().endsWith(CHAT_EXTENSION)) out.push(child.path)
  }
  return out
}
export async function chatsUnder(path: string): Promise<string[]> {
  const own = await readPointer(path)
  if (own) return [own]
  const tree = await invoke<Entry>('read_tree', { root: path, options: { showHidden: true } }).catch(() => null)
  if (!tree) return []
  const chats = await Promise.all(pointerPaths(tree, []).map(readPointer))
  return chats.filter((one) => one !== null)
}
export async function findPointers(
  rank: (chat: string, place: Place) => number = () => 0,
  unread: (root: string) => void = () => undefined,
): Promise<Map<string, Place>> {
  const found = new Map<string, Place>()
  for (const space of workspace.spaces) {
    const tree = await invoke<Entry>('read_tree', {
      root: space.root,
      options: { showHidden: false },
    }).catch(() => null)
    if (!tree) {
      unread(space.root)
      continue
    }
    for (const path of pointerPaths(tree, [])) {
      const chat = await readPointer(path)
      if (!chat) continue
      const place = { root: space.root, path }
      const held = found.get(chat)
      if (!held || rank(chat, place) > rank(chat, held)) found.set(chat, place)
    }
  }
  return found
}
