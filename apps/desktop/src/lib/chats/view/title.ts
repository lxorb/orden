import { type Conversation, UNKNOWN } from '@orden/chats/provider'
import { t } from '../../i18n.svelte'

function shownName(name: string): string {
  return name === UNKNOWN || name.trim() === '' ? t('Unknown') : name
}

export function conversationTitle(one: Conversation): string {
  if (one.title) return shownName(one.title)
  const names = one.people.map((person) => shownName(person.name)).join(', ')
  if (names) return names
  return one.kind === 'group' ? t('Unnamed group') : t('Unknown')
}
