import type { Level } from '@orden/chats/priority'

export function levelWord(level: Level): string {
  switch (level) {
    case 'urgent':
      return 'Urgent'
    case 'important':
      return 'Important'
    case 'if-time':
      return 'If time'
    case 'unimportant':
      return 'Unimportant'
  }
}
