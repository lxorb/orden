import { CHAT_EXTENSION, chatOf, chatText } from '@orden/chats'
import { nameOf, within, invoke, joinPath } from '../platform/src/api'
import { sync } from '../sync.svelte'
import { type Entry, workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { makeChat } from './http'

export interface Place {
  root: string
  path: string
}

export function chatName(path: string): string {
  const name = nameOf(path)
  return name.toLowerCase().endsWith(CHAT_EXTENSION) ? name.slice(0, -CHAT_EXTENSION.length) : name
}

function spaceOf(folder: string) {
  return workspace.spaces.find((one) => within(one.root, folder) !== null) ?? null
}

export async function makePointer(folder: string, name: string): Promise<Place | null> {
  const space = spaceOf(folder)
  const remote = space ? sync.remoteIdFor(space.root) : null
  if (!space || !remote) return null
  const pointer = await makeChat(remote)
  if (!pointer) return null

  const path = joinPath(folder, await workspace.freeNameOnDisk(folder, `${name}${CHAT_EXTENSION}`))
  const text = chatText(pointer)
  await writeFile(path, text)
  await workspace.fileCame(path, 'file')
  sync.wrote(path, text)
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
