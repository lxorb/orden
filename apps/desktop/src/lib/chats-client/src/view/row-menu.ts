import { chatLink } from '@orden/chats/links'
import { copyText } from '../../../ui-controls/src/api'
import { canWriteAt } from '../../../sharing/src/api'
import { DIVIDER, type MenuEntry } from '../../../ui-kit/src/api'
import { workspace } from '../../../workspace/src/api'
import { bellRows } from '../bell'
import { mayDelete } from '../deleting'
import type { ChatEntry } from '../shapes'
import { chatsView } from './chats-view.svelte'
import { store } from './source.svelte'

export function chatRowMenu(entry: ChatEntry): MenuEntry[] {
  const path = entry.path
  if (!path) return []
  const writable = canWriteAt(path)
  const ring = (notify: ChatEntry['notify'], mutedUntil: number | null) =>
    void store().notifyFor(entry.id, notify, mutedUntil)
  return [
    ...(writable ? [{ label: 'Rename', run: () => renaming(entry.id) }] : []),
    {
      label: 'Notifications',
      run: () => undefined,
      more: () => Promise.resolve(bellRows(entry.notify, entry.mutedUntil, entry.members, Date.now(), ring)),
    },
    { label: 'Copy link', run: () => void copyText(chatLink(entry.id)) },
    ...(writable ? [DIVIDER, { label: 'Delete', danger: true, run: () => void deleted(path) }] : []),
  ]
}
function renaming(chat: string): void {
  chatsView.naming = null
  chatsView.renaming = chat
}
async function deleted(path: string): Promise<void> {
  if (await mayDelete([path])) await workspace.remove(path, false)
}
export async function renamed(entry: ChatEntry, typed: string): Promise<void> {
  chatsView.renaming = null
  const name = typed.trim()
  if (entry.path && name && name !== entry.name) await workspace.rename(entry.path, `${name}.chat`)
}
