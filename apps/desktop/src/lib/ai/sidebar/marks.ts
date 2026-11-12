import { type SessionState, STATE_WORDS } from '../session-state'

export interface Marks {
  unread: boolean
  state: SessionState
}

export function rowName(title: string, marks: Marks): string {
  let name = title || 'Untitled'
  if (marks.unread) name = `${name}, unread`
  return `${name}, ${STATE_WORDS[marks.state].toLowerCase()}`
}
