import { t } from '../../i18n.svelte'
import { type SessionState, STATE_WORDS } from '../session-state'

export interface Marks {
  unread: boolean
  state: SessionState
}

export function rowName(title: string, marks: Marks): string {
  let name = title || t('Untitled')
  if (marks.unread) name = t('{title}, unread', { title: name })
  return t('{title}, {state}', { title: name, state: t(STATE_WORDS[marks.state]).toLowerCase() })
}
