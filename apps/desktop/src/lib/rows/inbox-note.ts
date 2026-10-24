/** A space's inbox as a path on this disk, made the first time it is needed and put in
 *  the file list: what quick add, a share, the glasses and the rows store each ask for
 *  when a task names no note. Its own file so asking does not start the rows store,
 *  which the glasses' plugin does not carry (docs/tasks.md 5.1, 5.18). */

import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { ensureInbox } from './inbox'

/** Null in a space shared to be read: the inbox is asked for only to write a task into,
 *  and that space takes neither the task nor a new inbox. Fetched, as sharing.svelte.ts
 *  starts the sync, which the glasses' plugin does not carry either. */
export async function inboxNote(root: string): Promise<string | null> {
  const { canWriteAt } = await import('../sharing.svelte')
  if (!canWriteAt(root)) return null
  return ensureInbox(root, async (path) => {
    await writeFile(path, '')
    await workspace.loadTree()
    await workspace.fileCame(path, 'file')
  })
}
