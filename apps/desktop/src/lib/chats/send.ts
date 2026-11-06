import { may } from '@orden/chats'
import { account } from '../account.svelte'
import { hiddenKinds } from '../settings.svelte'
import { t } from '../i18n.svelte'
import { prompt } from '../prompt.svelte'
import { nameOf, within, withoutExtension } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { headingAbove, sentWords } from './sent-words'
import { openChat } from './view/open'
import { store } from './view/source.svelte'

const NEW = '\0new'

export async function sendToChat(
  note: string,
  quote?: { text: string; heading?: string | null },
): Promise<void> {
  if (!account.accountToken) {
    account.ask()
    return
  }
  const chats = store()
  for (let waited = 0; !chats.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const space = workspace.spaces.find((one) => within(one.root, note) !== null) ?? null
  const ours = (root: string | null) => (root === space?.root ? 0 : 1)
  const open = chats.list
    .filter((one) => one.path && one.name && may(one.role, 'post', one.meta.posting))
    .sort((a, b) => ours(a.root) - ours(b.root))

  const chosen = await prompt.find({
    title: t('Send to chat'),
    placeholder: t('Chat'),
    options: [
      ...open.map((one) => ({ id: one.id, label: one.name ?? '', mark: 'chat' as const })),
      ...(space && hiddenKinds.offers('chat') ? [{ id: NEW, label: t('New chat') }] : []),
    ],
  })
  if (!chosen) return

  let chat = chosen
  let path = open.find((one) => one.id === chosen)?.path ?? null
  if (chosen === NEW && space) {
    path = await chats.make(space.root, t('Chat'))
    chat = (path ? await chats.chatAt(path) : null) ?? ''
  }
  if (!path || !chat) return

  openChat(path)
  chats.offer(chat, sentWords(withoutExtension(nameOf(note)), quote), { note })
}

export function sendSelection(note: string, text: string, from: number, to: number): Promise<void> {
  return sendToChat(note, { text: text.slice(from, to), heading: headingAbove(text, from) })
}
