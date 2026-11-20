import { isPagesTarget, isPdfTarget } from '@orden/markdown/links'
import { account } from '../../accounts/src/api'
import { keptAway } from '../../away/src/api'
import type { Binning, Kept } from '../../file-undo/src/api'
import type { FileOps } from '../../file-ops/src/api'
import { invoke, isMarkdownPath, oneWriteAt } from '../../platform/src/api'

interface Bins {
  readonly fileOps: FileOps
  savingSettled(): Promise<void>
  rootHolding(path: string | null): string | null
  loadTree(): Promise<void>
}
export async function bin(ws: Bins, path: string, isFolder: boolean, how: Binning = {}): Promise<Kept | null> {
  const { source, madeHere = false, settled = false } = how
  if (!settled) await ws.savingSettled()
  const words = !isFolder && !isPdfTarget(path)
  let content: string | null = null
  if (words) {
    content = await invoke<string>('read_note', { path }).catch(() => null)
    if (content) await invoke('snapshot_note', { path, content, source }).catch(() => undefined)
  }
  const unread = words && content === null && !keptAway.at(path)
  const toAccount =
    account.signedIn &&
    !madeHere &&
    !unread &&
    !(!isFolder && isPagesTarget(path)) &&
    (await accountHolds(ws, path, isFolder))
  const held = toAccount && isFolder ? await (await import('./undoing')).heldIn(path) : null
  const gone = {
    op: 'removed',
    path,
    kind: isFolder ? 'folder' : 'file',
    root: ws.rootHolding(path),
  } as const
  try {
    if (toAccount) {
      const { sync } = await import('../../sync-store/src/api')
      const back = sync.tracked(path)?.id ?? crypto.randomUUID()
      await ws.fileOps.doing({ ...gone, back }, () =>
        oneWriteAt(path, () => invoke(isFolder ? 'delete_folder' : 'delete_note', { path })),
      )
      if (isFolder) return held && { content: '', folder: true, ...held, back }
      return words ? { content: content ?? '', back } : null
    }
    let trashId = ''
    await ws.fileOps.doing(gone, async () => {
      const entry = await oneWriteAt(path, () =>
        invoke<{ id: string }>('trash_item', { path, kind: isFolder ? 'folder' : 'note' }),
      )
      trashId = entry.id
      return entry.id
    })
    return { content: content ?? '', trashId, ...(isFolder ? { folder: true } : {}) }
  } catch (error) {
    await ws.loadTree()
    throw error
  }
}
async function accountHolds(ws: Bins, path: string, isFolder: boolean): Promise<boolean> {
  if (!isFolder && !isMarkdownPath(path)) return false
  const root = ws.rootHolding(path)
  if (!root) return false
  const { sync } = await import('../../sync-store/src/api')
  const id = sync.remoteIdFor(root)
  if (account.spaces.find((one) => one.id === id)?.role !== 'owner') return false
  if (!isFolder) return sync.holds(path)
  const { accountHoldsAll } = await import('./undoing')
  return accountHoldsAll(path, (one, how) => sync.holds(one, how))
}
