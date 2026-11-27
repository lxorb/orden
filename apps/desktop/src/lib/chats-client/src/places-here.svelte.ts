import type { ChatPlace, ChatPlaces, ChatPlacesHeard, Entry } from '@orden/contracts'
import { CHAT_EXTENSION, chatOf, chatText } from '@orden/chats'
import { untrack } from 'svelte'
import { isRetiredChat } from '../../documents/src/api'
import type { FileOp } from '../../file-ops/src/api'
import { writeFile } from '../../file-writes/src/api'
import { chatsOn } from '../../gates/src/api'
import { invoke, joinPath, spaceHolding } from '../../platform/src/api'
import { sync } from '../../sync-store/src/api'
import { workspace } from '../../workspace/src/api'
import { makeChat } from './http'

const isPointer = (path: string) => path.toLowerCase().endsWith(CHAT_EXTENSION)
async function make(folder: string, name: string): Promise<ChatPlace | null> {
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
async function read(path: string): Promise<string | null> {
  if (!isPointer(path)) return null
  const text = await invoke<string>('read_note', { path }).catch(() => null)
  return text === null ? null : (chatOf(text)?.chat ?? null)
}
function pointerPaths(entry: Entry | null, out: string[] = []): string[] {
  for (const child of entry?.children ?? []) {
    if (child.is_dir) pointerPaths(child, out)
    else if (isPointer(child.name)) out.push(child.path)
  }
  return out
}
async function under(path: string): Promise<string[]> {
  const own = await read(path)
  if (own) return [own]
  const tree = await invoke<Entry>('read_tree', { root: path, options: { showHidden: true } }).catch(() => null)
  if (!tree) return []
  const chats = await Promise.all(pointerPaths(tree).map(read))
  return chats.filter((one) => one !== null)
}
async function find(
  rank: (chat: string, place: ChatPlace) => number,
  unread: (root: string) => void,
): Promise<Map<string, ChatPlace>> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and handed back in this call
  const found = new Map<string, ChatPlace>()
  for (const space of workspace.spaces) {
    const tree = await invoke<Entry>('read_tree', {
      root: space.root,
      options: { showHidden: false },
    }).catch(() => null)
    if (!tree) {
      unread(space.root)
      continue
    }
    for (const path of pointerPaths(tree)) {
      const chat = await read(path)
      if (!chat) continue
      const place = { root: space.root, path }
      const held = found.get(chat)
      if (!held || rank(chat, place) > rank(chat, held)) found.set(chat, place)
    }
  }
  return found
}
function follow(heard: ChatPlacesHeard): void {
  $effect.root(() => {
    $effect(() => {
      if (!chatsOn()) return
      const pointers = pointerPaths(workspace.tree)
      const root = workspace.activeSpace?.root ?? null
      untrack(() => heard.seen(root, pointers))
    })
  })
  workspace.fileOps.follow((op: FileOp) => {
    if (op.op === 'created') {
      if (op.kind === 'file' && isPointer(op.path)) heard.moved(null, op.path)
      return
    }
    if (op.op === 'removed') {
      if (op.kind === 'file' && isPointer(op.path)) heard.moved(op.path, null)
      else if (op.kind !== 'file') heard.lookAgain()
      return
    }
    if (op.kind === 'file') {
      if (isPointer(op.from) || isPointer(op.to)) heard.moved(op.from, op.to)
      return
    }
    heard.folderMoved(op.from, op.to)
    heard.lookAgain()
  })
}
export const placesHere: ChatPlaces = {
  rootHolding: (path) => spaceHolding(workspace.spaces, path)?.root ?? null,
  rootOf: (space) => workspace.spaces.find((one) => sync.remoteIdFor(one.root) === space)?.root ?? null,
  remoteOf: (root) => sync.remoteIdFor(root),
  noteId: (path) => sync.tracked(path)?.id ?? null,
  nudge: () => sync.nudge(),
  retired: isRetiredChat,
  find,
  read,
  make,
  under,
  follow,
}
