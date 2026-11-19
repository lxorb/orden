import type { SyncFileOp, WorkspaceSpace } from '@orden/contracts'
import { findLinks } from '@orden/markdown/links'
import { isTodoSpace, todoSpaceOf } from './space'
import type { TodoStore } from './store.svelte'

const bare = (path: string) => path.replace(/\.md$/i, '')
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
function movedTarget(target: string, from: string, to: string, folder: boolean): string | null {
  const ext = /\.md$/i.test(target) ? target.slice(-3) : ''
  const plain = bare(target).toLowerCase()
  const was = bare(from).toLowerCase()
  if (!plain.includes('/')) return !folder && plain === nameOf(was) ? nameOf(bare(to)) + ext : null
  if (plain === was) return bare(to) + ext
  return plain.startsWith(`${was}/`) ? bare(to) + bare(target).slice(was.length) + ext : null
}
export function relinked(text: string, from: string, to: string, folder = false): string {
  let out = text
  for (const link of findLinks(text).reverse()) {
    if (link.kind !== 'wikilink') continue
    const written = text.slice(link.targetFrom, link.targetTo)
    const lead = written.startsWith('/') ? '/' : ''
    const moved = movedTarget(written.slice(lead.length), from, to, folder)
    if (moved !== null) out = `${out.slice(0, link.targetFrom)}${lead}${moved}${out.slice(link.targetTo)}`
  }
  return out
}
export const followingMoves =
  (store: TodoStore, spaces: () => readonly WorkspaceSpace[]) =>
  (op: SyncFileOp): Promise<unknown> | undefined => {
    if (op.op !== 'moved' || op.kind === 'space' || !op.root || (op.heard && !op.watched)) return
    const { root, into, kind } = op
    return import('../../platform/src/api').then(({ samePath, within }) => {
      const space = spaces().find((one) => samePath(one.root, root))
      const from = within(root, op.from, root)
      const to = within(root, op.to, root)
      if (!space || from === null || to === null || (into !== undefined && !samePath(into, root))) return
      const held = todoSpaceOf(space)
      return Promise.all(
        store.todos.flatMap((one) => {
          if (!isTodoSpace(held, one.space)) return []
          const description = relinked(one.description, from, to, kind === 'folder')
          return description === one.description ? [] : [store.update(one.id, { description })]
        }),
      )
    })
  }
