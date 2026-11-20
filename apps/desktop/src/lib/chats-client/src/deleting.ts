import { isChatTarget } from '@orden/markdown/links'
import { samePath, within } from '../../platform/src/api'
import { prompt } from '../../ui-kit/src/api'
import { endChat } from './http'
import { chats } from './store.svelte'

const WITHIN = 60_000
const ending = new Map<string, { chat: string; at: number }>()

export async function mayDelete(paths: readonly string[]): Promise<boolean> {
  const asked = paths.filter((path) => isChatTarget(path))
  const full = chats.list.filter(
    (one) => one.lastSeq > 0 && asked.some((path) => one.path !== null && samePath(one.path, path)),
  )
  const [one] = full
  const many = full.length > 1
  const yes =
    !one ||
    (await prompt.confirm({
      title: many ? `Delete ${String(full.length)} chats with messages?` : `Delete ${one.name ?? 'this chat'}?`,
      detail: `${many ? 'They hold' : 'It holds'} messages. Deleting takes ${many ? 'them' : 'it'} out of the space into Recently deleted, and the messages are kept with the chat.`,
      confirmLabel: 'Delete',
      danger: true,
    }))
  if (yes) {
    for (const entry of chats.list) {
      const at = entry.path
      if (at && asked.some((path) => samePath(at, path))) ending.set(at, { chat: entry.id, at: Date.now() })
    }
  }
  return yes
}
export function pointersGone(path: string, folder: boolean): void {
  const now = Date.now()
  for (const [pointer, one] of ending) {
    if (now - one.at > WITHIN) {
      ending.delete(pointer)
      continue
    }
    if (folder ? within(path, pointer) === null : !samePath(pointer, path)) continue
    ending.delete(pointer)
    void endChat(one.chat)
  }
}
