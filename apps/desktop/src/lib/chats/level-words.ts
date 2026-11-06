import type { Level } from '@orden/chats/priority'
import { t } from '../i18n.svelte'

export function levelWord(level: Level): string {
  switch (level) {
    case 'urgent':
      return t('Urgent')
    case 'important':
      return t('Important')
    case 'if-time':
      return t('If time')
    case 'unimportant':
      return t('Unimportant')
  }
}
