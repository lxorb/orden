import { INBOX_KEY } from '@orden/bases/inbox'
import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { accountInbox } from '../inbox/account.svelte'
import { type Carrying, carriedFrom, madeByOrden } from '../inbox/carrying'
import { links } from '../link-index.svelte'
import { log } from '../log'
import { readIfThere } from '../read-if-there'
import { insideSpace, samePath, within } from '../space-paths'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { forgetPicked, LEGACY_INBOX, OLD_INBOX, pickedInbox } from './inbox'
import type { RowsChange } from './store'

const carrying = (root: string): Carrying => ({
  read: (path) => readIfThere(path).catch(() => null),
  meta: (path) => workspace.itemMeta.of(path, root),
  write: (path, text) => writeFile(path, text),
  async remove(path) {
    const content = await invoke<string>('read_note', { path }).catch(() => null)
    if (content !== null) await invoke('snapshot_note', { path, content }).catch(() => undefined)
    await invoke('delete_note', { path })
    await workspace.fileGone(path, 'file')
  },
  carried: (items) => accountInbox.carried(items),
  headed: (text) => accountInbox.headed(text),
  kept: (ids) => accountInbox.kept(ids),
})

function knownOwner(): boolean {
  const owner = account.user?.id ?? null
  if (account.token && owner === null) return false
  return accountInbox.openedFor === owner
}

async function moveIn(root: string): Promise<void> {
  const { canWriteAt } = await import('../sharing.svelte')
  if (!canWriteAt(root) || !knownOwner()) return
  const how = carrying(root)
  const items = Object.entries(workspace.itemMeta.itemsOf(root))
  const picked = pickedInbox(root, items)
  for (const name of [LEGACY_INBOX, OLD_INBOX]) {
    if (picked !== null && samePath(picked, name, root)) continue
    const path = insideSpace(root, name)
    if (name === OLD_INBOX) {
      const words = await how.read(path)
      if (words === null || !madeByOrden(words)) continue
    }
    const moved = await carriedFrom(path, how, true)
    if (moved === 'carried') log('info', `inbox: ${root}/${name} moved into the account inbox`)
  }
  if (picked === null) return
  const path = insideSpace(root, picked)
  const moved = await carriedFrom(path, how, false)
  if (moved === 'waiting') return
  if (moved === 'carried') {
    workspace.itemMeta.set(path, { [INBOX_KEY]: null }, root)
  }
  for (const [relative, meta] of items) {
    if (meta[INBOX_KEY] !== undefined && !samePath(relative, picked, root)) {
      workspace.itemMeta.set(insideSpace(root, relative), { [INBOX_KEY]: null }, root)
    }
  }
  forgetPicked(root)
}

export async function carryInto(root: string, path: string): Promise<void> {
  await carriedFrom(path, carrying(root), false)
}

const asked: string[] = []
let running: Promise<void> = Promise.resolve()

export function lookAt(root: string): void {
  if (asked.includes(root)) return
  asked.push(root)
  running = running
    .then(async () => {
      asked.splice(asked.indexOf(root), 1)
      await moveIn(root)
    })
    .catch((error: unknown) => {
      log('warn', `inbox: ${root} not moved into the account inbox - ${String(error)}`)
    })
}

export function heard(change: RowsChange): void {
  if (change.path === null) lookAt(change.root)
}

links.hearSaves((path) => {
  const root = workspace.rootHolding(path)
  if (root === null) return
  const relative = within(root, path, root)
  if (relative === null) return
  if (samePath(relative, LEGACY_INBOX, root) || samePath(relative, OLD_INBOX, root)) lookAt(root)
})

$effect.root(() => {
  $effect(() => {
    if (accountInbox.answers === false || accountInbox.openedFor === undefined) return
    untrack(() => {
      for (const space of workspace.shownSpaces) lookAt(space.root)
    })
  })
})
