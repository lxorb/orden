/** What a chat's row says of it besides its title (#1064), the same in every list of
 *  chats (Threads.svelte, the panel's home in Conversation.svelte): unread, where the
 *  agent answered or asked since the reader last saw it, and running, where it is at
 *  work. A screen reader hears both in the row's name. */

import { t } from '../../i18n.svelte'

export interface Marks {
  unread: boolean
  running: boolean
}

/** The row's name: its title, then what it is. */
export function rowName(title: string, marks: Marks): string {
  let name = title || t('Untitled')
  if (marks.unread) name = t('{title}, unread', { title: name })
  if (marks.running) name = t('{title}, running', { title: name })
  return name
}
