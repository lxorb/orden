import { account, api } from '../../accounts/src/api'
import { sync } from '../../sync-store/src/api'
import { invoke } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { protection } from '../../protect/src/api'
import type { TrashItem } from './trash.svelte'

export async function restored(item: TrashItem): Promise<void> {
  if (item.source === 'device') {
    const at = await invoke<string>('restore_trash', { id: item.ref })
    workspace.undone.forget(item.ref)
    if (item.kind === 'space' && item.from !== undefined) await workspace.spaceCameBack(item.from, at)
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
