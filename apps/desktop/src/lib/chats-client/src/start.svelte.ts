import { untrack } from 'svelte'
import { CHAT_EXTENSION } from '@orden/chats'
import { account } from '../../accounts/src/api'
import { hub } from '../../sync-client/src/api'
import { chatsOn } from '../../settings.svelte'
import { isMobile } from '../../platform/src/api'
import { type Entry, workspace } from '../../workspace.svelte'
import type { FileOp } from '../../workspace/file-ops'
import { chats } from './store.svelte'

const isPointer = (path: string) => path.toLowerCase().endsWith(CHAT_EXTENSION)

function followed(op: FileOp): void {
  if (op.op === 'created') {
    if (op.kind === 'file' && isPointer(op.path)) void chats.pointerMoved(null, op.path)
    return
  }
  if (op.op === 'removed') {
    if (op.kind === 'file' && isPointer(op.path)) void chats.pointerMoved(op.path, null)
    else if (op.kind !== 'file') void chats.lookAgain()
    return
  }
  if (op.kind === 'file') {
    if (isPointer(op.from) || isPointer(op.to)) void chats.pointerMoved(op.from, op.to)
    return
  }
  chats.folderMoved(op.from, op.to)
  void chats.lookAgain()
}

function pointersIn(entry: Entry | null, out: string[] = []): string[] {
  for (const child of entry?.children ?? []) {
    if (child.is_dir) pointersIn(child, out)
    else if (isPointer(child.path)) out.push(child.path)
  }
  return out
}

$effect.root(() => {
  $effect(() => {
    if (!chatsOn()) return
    const pointers = pointersIn(workspace.tree)
    const root = workspace.activeSpace?.root ?? null
    untrack(() => chats.pointersSeen(root, pointers))
  })
  $effect(() => {
    const who = chatsOn() ? (account.user?.id ?? account.guest?.id ?? null) : null
    untrack(() => void chats.start(who))
  })
})

account.forgetWithSession(() => void chats.forget())
hub.on('chat', (frame) => chats.poked(frame.said))
hub.opened(() => void chats.reconnected())
workspace.fileOps.follow(followed)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void chats.reconnected())
}
if (!isMobile) void import('./notices')
