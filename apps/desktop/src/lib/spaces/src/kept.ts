import type { RemoteSpace } from '../../accounts/src/api'
import { workspace } from '../../workspace/src/api'

export async function adoptKept(root: string, remote: RemoteSpace, who: string): Promise<void> {
  const read = remote.role === 'read'
  workspace.folderIcons.adopt(root, remote.icons, remote.tints, who, read)
  workspace.graphSettings.adopt(root, remote.graph, who, read)
  workspace.sorting.adopt(root, remote.sort, who, read)
  workspace.excluded.adopt(root, remote.excluded, who, read)
  await Promise.all([
    workspace.arranged.adopt(root, remote.arranged, who, read),
    workspace.archive.adopt(root, remote.archived, who, read),
  ])
}
