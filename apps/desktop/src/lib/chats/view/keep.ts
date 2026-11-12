import type { Message } from '@orden/chats'
import { isWho } from '@orden/chats/wire'
import { chatLink } from '@orden/chats/links'
import { storeBeside } from '../../assets'
import { canWriteAt } from '../../sharing.svelte'
import { folderOf } from '../../space-paths'
import { showQuickAdd } from '../../surfaces.svelte'
import { joinPath } from '../../tauri'
import { workspace } from '../../workspace.svelte'
import { writeFile } from '../../workspace/write-file'
import type { ChatPage } from './chat.svelte'
import { noteNameOf, quoted, taskWords } from './keep-words'
import { nameOf } from './people'
import { store } from './source.svelte'
import { fullTime } from './when'

function linkBack(page: ChatPage, message: Message): string {
  return `[#${page.entry?.name ?? ''}](${chatLink(page.id, message.id)})`
}

export function addAsTask(page: ChatPage, message: Message, space: string | null): void {
  const called = message.mentions
    .filter(isWho)
    .filter((who) => who !== page.me)
    .map((who) => nameOf(who, page.members, space))
  showQuickAdd({
    text: taskWords(message.body || (message.files.at(0)?.name ?? ''), called),
    description: linkBack(page, message),
  })
}

export async function saveAsNote(
  page: ChatPage,
  message: Message,
  space: string | null,
): Promise<void> {
  const entry = page.entry
  if (!entry?.path || !canWriteAt(entry.path)) return
  const folder = folderOf(entry.path)
  const name = noteNameOf(message.body, entry.name ?? 'Chat')
  const path = joinPath(folder, await workspace.freeNameOnDisk(folder, `${name}.md`))

  const replies = message.replies
    ? await store().history(page.id, { parent: message.id, limit: 200 })
    : []
  const parts: string[] = []
  for (const one of [message, ...replies.filter((reply) => !reply.deleted)]) {
    const files: string[] = []
    for (const file of one.files) {
      const url = await store().fileUrl(page.id, file.hash)
      const bytes = url
        ? await fetch(url)
            .then((answer) => answer.arrayBuffer())
            .catch(() => null)
        : null
      const kept = bytes ? await storeBeside(bytes, path, file.name) : null
      if (kept) files.push(kept)
    }
    parts.push(quoted(nameOf(one.author, page.members, space), fullTime(one.at), one.body, files))
  }

  await writeFile(path, `${parts.join('\n\n')}\n\n${linkBack(page, message)}\n`)
  await workspace.fileCame(path, 'file')
  await workspace.open(path)
}
