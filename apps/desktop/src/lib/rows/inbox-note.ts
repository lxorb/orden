import { toldIfUnreadable } from '../read-if-there'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { pathKey, relativeTo } from '../space-paths'
import { ensureInbox, isInternalInbox } from './inbox'

const making = new Map<string, Promise<string | null>>()

export function inboxNote(root: string): Promise<string | null> {
  const key = pathKey(root)
  const running = making.get(key)
  if (running) return running
  const made = madeInbox(root).finally(() => making.delete(key))
  making.set(key, made)
  return made
}

async function madeInbox(root: string): Promise<string | null> {
  const { canWriteAt } = await import('../sharing.svelte')
  if (!canWriteAt(root)) return null
  try {
    return await ensureInbox(root, async (path) => {
      await writeFile(path, '')
      if (!isInternalInbox(relativeTo(root, path))) await workspace.loadTree()
      await workspace.fileCame(path, 'file')
    })
  } catch (error) {
    return toldIfUnreadable(error)
  }
}
