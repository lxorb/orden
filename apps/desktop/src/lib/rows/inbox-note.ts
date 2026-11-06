import { toldIfUnreadable } from '../read-if-there'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { relativeTo } from '../space-paths'
import { ensureInbox, isInternalInbox } from './inbox'

export async function inboxNote(root: string): Promise<string | null> {
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
