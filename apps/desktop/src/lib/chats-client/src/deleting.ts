import { isChatTarget } from '@orden/markdown/links'
import { samePath } from '../../platform/src/api'
import { prompt } from '../../ui-kit/src/api'
import { endChat } from './http'
import { chatsUnder } from './pointers'
import { chats } from './store.svelte'

export async function mayDelete(paths: readonly string[]): Promise<boolean> {
  const asked = paths.filter((path) => isChatTarget(path))
  const full = chats.list.filter(
    (one) => one.lastSeq > 0 && asked.some((path) => one.path !== null && samePath(one.path, path)),
  )
  const [one] = full
  if (!one) return true
  const many = full.length > 1
  return prompt.confirm({
    title: many ? `Delete ${String(full.length)} chats with messages?` : `Delete ${one.name ?? 'this chat'}?`,
    detail: `${many ? 'They hold' : 'It holds'} messages. Deleting takes ${many ? 'them' : 'it'} out of the space into Recently deleted, and the messages are kept with the chat.`,
    confirmLabel: 'Delete',
    danger: true,
  })
}
export async function ending(paths: readonly string[]): Promise<() => void> {
  const going = new Set((await Promise.all(paths.map(chatsUnder))).flat())
  return () => {
    for (const chat of going) void endChat(chat)
  }
}
