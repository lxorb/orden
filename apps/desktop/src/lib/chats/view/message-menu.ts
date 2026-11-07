import { may, type Message, type Role } from '@orden/chats'
import { copyText } from '../../clipboard'
import { t } from '../../i18n.svelte'
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
  const can = page.can
  if (message.deleted) return []
  const removing: MenuEntry[] = page.service
    ? [
        ...(can.removeFor !== null &&
        page.mayRemoveForAll(message) &&
        (mine || may(role, 'delete-any', posting))
          ? [
              {
                label: t('Delete for everyone'),
                danger: true,
                run: () => page.remove(message.id, true),
              },
            ]
          : []),
        ...(can.removeForMe
          ? [{ label: t('Delete for me'), danger: true, run: () => page.remove(message.id, false) }]
          : []),
      ]
    : (mine && may(role, 'delete-own', posting)) || may(role, 'delete-any', posting)
      ? [{ label: t('Delete'), danger: true, run: () => page.remove(message.id) }]
      : []
  return [
    ...(canPost && can.threads ? [{ label: t('Reply'), run: gestures.reply }] : []),
    ...(canPost && can.quote ? [{ label: t('Quote'), run: gestures.quote }] : []),
    DIVIDER,
    { label: t('Copy'), run: () => void copyText(message.body) },
    ...(can.link ? [{ label: t('Copy link'), run: () => void page.copyLink(message) }] : []),
    ...(may(role, 'pin', posting) && can.pin
      ? [{ label: message.pinned ? t('Unpin') : t('Pin'), run: () => page.pin(message) }]
      : []),
    { label: t('Save'), checked: page.isSaved(message), run: () => page.save(message) },
    { label: t('Add as task'), run: () => page.addAsTask(message) },
    ...(canKeep ? [{ label: t('Save as note'), run: () => void page.saveAsNote(message) }] : []),
    ...(can.markUnread ? [{ label: t('Mark unread'), run: () => page.markUnread(message) }] : []),
    DIVIDER,
    ...(mine && may(role, 'edit-own', posting) && !message.poll && page.mayEdit(message)
      ? [{ label: t('Edit'), run: gestures.edit }]
      : []),
    ...removing,
  ]
}
