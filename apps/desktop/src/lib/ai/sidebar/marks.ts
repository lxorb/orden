/** What a chat's row says of it besides its title, the same in every list of chats
 *  (ChatRow.svelte, drawn by Threads.svelte and the panel's home in Conversation.svelte):
 *  unread, where the agent answered or asked since the reader last saw it (#1064), and
 *  the state it is in (#1089). A screen reader hears both in the row's name. */

import { t } from '../../i18n.svelte'
import { type SessionState, STATE_WORDS } from '../session-state'

export interface Marks {
  unread: boolean
  state: SessionState
}

/** The row's name: its title, then what it is. */
export function rowName(title: string, marks: Marks): string {
  let name = title || t('Untitled')
  if (marks.unread) name = t('{title}, unread', { title: name })
  return t('{title}, {state}', { title: name, state: t(STATE_WORDS[marks.state]).toLowerCase() })
}
