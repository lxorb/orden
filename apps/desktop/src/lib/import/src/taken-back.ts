import { folderOf, invoke, samePath } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'

export async function takenBack(paths: readonly string[], under: string): Promise<void> {
  const folders = new Set<string>()
  for (const path of paths) {
    const kept = await workspace.bin(path, false, { madeHere: true }).catch(() => null)
    if (kept) await workspace.fileGone(path, 'file', kept.trashId ?? kept.back)
    for (
      let folder = folderOf(path);
      folder && !samePath(folder, under) && folder.startsWith(under);
      folder = folderOf(folder)
    )
      folders.add(folder)
  }
  const deepestFirst = [...folders].sort((one, two) => two.length - one.length)
  for (const folder of deepestFirst) await invoke('remove_empty_folder', { path: folder }).catch(() => undefined)
  await workspace.loadTree()
}
