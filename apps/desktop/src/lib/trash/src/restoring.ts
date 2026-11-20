import { account, api } from '../../accounts/src/api'
import { sync } from '../../sync-store/src/api'
import { folderOf, invoke, joinPath, KEPT_HOME, nameOf } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { protection } from '../../protect/src/api'
import type { TrashItem } from './trash.svelte'

async function spaceRoot(path: string): Promise<string> {
  const placed = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
  const at = placed ? path : joinPath(await invoke<string>('spaces_root'), path)
  const slashed = at.replace(/\\/g, '/')
  return nameOf(folderOf(slashed)) === KEPT_HOME ? joinPath(at, nameOf(slashed)) : at
}
export async function restored(item: TrashItem): Promise<void> {
  if (item.source === 'device') {
    const back = await invoke<string>('restore_trash', { id: item.ref })
    const at = item.kind === 'space' ? await spaceRoot(back) : back
    workspace.undone.forget(item.ref)
    if (item.kind === 'space' && item.from !== undefined) await workspace.spaceCameBack(await spaceRoot(item.from), at)
    else await workspace.loadSpaces()
    await workspace.loadTree()
    if (item.kind === 'space') await protection.unbury(item.ref, at, '')
    else {
      await workspace.fileCame(at, item.kind === 'folder' ? 'folder' : 'file', undefined, item.ref)
    }
    return
  }
  const token = account.accountToken
  if (!token) return
  const was = item.note?.path ?? ''
  let landed = was
  if (item.kind === 'space') {
    await api.restoreSpace(token, item.ref)
    await account.loadSpaces()
  } else {
    landed = (await api.restoreNote(token, item.ref)).note.path || was
  }
  const spaceId = item.note?.spaceId ?? item.ref
  const space = workspace.spaces.find((one) => sync.remoteIdFor(one.root) === spaceId)
  if (space) await protection.unbury(item.ref, space.root, landed, was)
  sync.nudge()
}
