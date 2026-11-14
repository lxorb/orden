import { may, type Message, type Role } from '@orden/chats'
import { copyText } from '../../ui-controls/src/api'
import { DIVIDER, type MenuEntry } from '../../menu.svelte'
import { canWriteAt } from '../../sharing.svelte'
import type { ChatPage } from './chat.svelte'

export interface MessageGestures {
  reply: () => void
  quote: () => void
  edit: () => void
}

export function messageMenu(
  page: ChatPage,
  message: Message,
  role: Role | null,
  gestures: MessageGestures,
): MenuEntry[] {
  const posting = page.view.meta.posting
  const mine = page.me !== null && message.author === page.me
  const canPost = may(role, 'post', posting)
  const canKeep = !page.entry?.path || canWriteAt(page.entry.path)
  if (message.deleted) return []
  const removing: MenuEntry[] =
    (mine && may(role, 'delete-own', posting)) || may(role, 'delete-any', posting)
      ? [{ label: 'Delete', danger: true, run: () => page.remove(message.id) }]
      : []
  return [
    ...(canPost ? [{ label: 'Reply', run: gestures.reply }] : []),
    ...(canPost ? [{ label: 'Quote', run: gestures.quote }] : []),
    DIVIDER,
    { label: 'Copy', run: () => void copyText(message.body) },
    { label: 'Copy link', run: () => void page.copyLink(message) },
    ...(may(role, 'pin', posting)
      ? [{ label: message.pinned ? 'Unpin' : 'Pin', run: () => page.pin(message) }]
      : []),
    { label: 'Save', checked: page.isSaved(message), run: () => page.save(message) },
    { label: 'Add as task', run: () => page.addAsTask(message) },
    ...(canKeep ? [{ label: 'Save as note', run: () => void page.saveAsNote(message) }] : []),
    { label: 'Mark unread', run: () => page.markUnread(message) },
    DIVIDER,
    ...(mine && may(role, 'edit-own', posting) && !message.poll
      ? [{ label: 'Edit', run: gestures.edit }]
      : []),
    ...removing,
  ]
}
