import type { ChatProvider, Host } from '../provider'
import type { Dial } from './client'

export type { Client, ClientState, Dial, Found, Setup, SentCode } from './client'
export { signedOut } from './client'

export const API_ID = 'telegramApiId'
export const API_HASH = 'telegramApiHash'

const ICON =
  'M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z'

const EDIT_FOR = 48 * 60 * 60 * 1000
const MOST_FILE = 2 * 1024 * 1024 * 1024

export const REACTIONS = [
  '👍',
  '👎',
  '❤',
  '🔥',
  '🥰',
  '👏',
  '😁',
  '🤔',
  '🤯',
  '😱',
  '🤬',
  '😢',
  '🎉',
  '🤩',
  '🤮',
  '💩',
  '🙏',
  '👌',
  '🕊',
  '🤡',
  '🥱',
  '🥴',
  '😍',
  '🐳',
  '❤‍🔥',
  '🌚',
  '🌭',
  '💯',
  '🤣',
  '⚡',
  '🍌',
  '🏆',
  '💔',
  '🤨',
  '😐',
  '🍓',
  '🍾',
  '💋',
  '🖕',
  '😈',
  '😴',
  '😭',
  '🤓',
  '👻',
  '👨‍💻',
  '👀',
  '🎃',
  '🙈',
  '😇',
  '😨',
  '🤝',
  '✍',
  '🤗',
  '🫡',
  '🎅',
  '🎄',
  '☃',
  '💅',
  '🤪',
  '🗿',
  '🆒',
  '💘',
  '🙉',
  '🦄',
  '😘',
  '💊',
  '🙊',
  '😎',
  '👾',
  '🤷‍♂',
  '🤷',
  '🤷‍♀',
  '😡',
] as const

function keysOf(host: Host): { apiId: number; apiHash: string } | null {
  const apiId = Number(host.build?.[API_ID] ?? '')
  const apiHash = host.build?.[API_HASH] ?? ''
  return Number.isInteger(apiId) && apiId > 0 && /^[0-9a-f]{32}$/i.test(apiHash)
    ? { apiId, apiHash }
    : null
}

export function telegramProvider(dial: Dial): ChatProvider {
  return {
    id: 'telegram',
    name: 'Telegram',
    icon: ICON,
    fields: [
      {
        key: 'phone',
        label: 'Phone number',
        kind: 'phone',
        optional: true,
        placeholder: '+41 79 123 45 67',
        note: 'Leave it empty to sign in with a QR code instead',
      },
    ],
    can: {
      send: true,
      attachments: true,
      live: true,
      replies: true,
      threads: true,
      editFor: EDIT_FOR,
      removeForMe: true,
      reactions: REACTIONS,
      voice: true,
      polls: true,
      receipts: true,
      presence: true,
      maxFile: MOST_FILE,
      formatting: 'markdown',
    },
    available: (host) => keysOf(host) !== null && !!host.ask,
    async connect(config, host, account) {
      const keys = keysOf(host)
      if (!keys) throw new Error('Telegram is not set up in this build')
      const { open } = await import('./connection')
      return open(dial, keys, config, host, account)
    },
    async forget(account, host) {
      const { forget } = await import('./connection')
      await forget(dial, keysOf(host), account, host)
    },
  }
}
