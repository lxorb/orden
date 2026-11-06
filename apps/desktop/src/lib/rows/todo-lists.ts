import {
  CANCELLED_KEY,
  DONE_KEY,
  isTodoList,
  LIST_KEY,
  LIST_VALUE,
  type Meta,
} from '@orden/bases/todo-lists'
import { insideSpace, isMarkdownPath, relativeTo, within } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { inboxOf } from './inbox'
import { projectsOf } from './projects'

export function listedAt(root: string, relative: string, meta?: Meta): boolean {
  const said = meta === undefined ? workspace.itemMeta.of(insideSpace(root, relative), root) : meta
  return isTodoList(relative, said, inboxOf(root))
}

export function isListed(path: string): boolean {
  const root = workspace.rootHolding(path)
  if (root === null) return false
  return isTodoList(relativeTo(root, path), workspace.itemMeta.of(path, root), inboxOf(root))
}

export function makeList(path: string): void {
  workspace.itemMeta.set(path, { [LIST_KEY]: LIST_VALUE })
}

export function unmakeList(path: string): void {
  workspace.itemMeta.set(path, { [LIST_KEY]: null, [DONE_KEY]: null, [CANCELLED_KEY]: null })
}

const keyOf = (path: string) => path.replace(/\\/g, '/').normalize('NFC').toLowerCase()

export function listsIn(root: string): string[] {
  return workspace.notes
    .filter((one) => isMarkdownPath(one.path) && within(root, one.path, root) !== null)
    .map((one) => relativeTo(root, one.path))
    .filter((relative) => listedAt(root, relative))
}

export function listNamed(root: string, said: string): string | null {
  const plain = said
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
  if (!plain || plain.split('/').some((part) => part === '..' || part === '.')) return null
  const wanted = /\.md$/i.test(plain) ? plain : `${plain}.md`
  const lists = listsIn(root)
  const name = wanted.split('/').pop() ?? wanted
  const found =
    lists.find((one) => keyOf(one) === keyOf(wanted)) ??
    lists.find((one) => keyOf(one.split('/').pop() ?? one) === keyOf(name))
  if (found) return found
  const taken = new Set(
    workspace.notes
      .filter((one) => within(root, one.path, root) !== null)
      .map((one) => keyOf(relativeTo(root, one.path))),
  )
  const folder = projectsOf(root).replace(/^\/+|\/+$/g, '')
  const stem = name.replace(/\.md$/i, '')
  for (let count = 1; ; count++) {
    const named = count === 1 ? `${stem}.md` : `${stem} ${count}.md`
    const relative = folder ? `${folder}/${named}` : named
    if (!taken.has(keyOf(relative))) return relative
  }
}
