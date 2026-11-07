import { type ChatProvider, secretName } from '../provider'
import type { Dial } from './client'
import type { Keys } from './connection'

export type { Client, ClientState, Dial, Found, Setup, SentCode } from './client'
export { signedOut } from './client'

export const API_ID = 'apiId'
export const API_HASH = 'apiHash'

const NO_KEYS = 'Paste the API ID and hash from my.telegram.org'

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

function keysOf(given: Readonly<Record<string, string | null | undefined>>): Keys | null {
  const apiId = Number((given[API_ID] ?? '').trim())
  const apiHash = (given[API_HASH] ?? '').trim()
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
        key: API_ID,
        label: 'API ID',
        kind: 'number',
        secret: true,
        placeholder: '1234567',
        note: 'From my.telegram.org, under API development tools',
        help: {
          url: 'https://my.telegram.org/apps',
          label: 'How to get your API ID and hash',
          steps: [
            'Sign in at my.telegram.org with your phone number',
            'Open API development tools and create an app with any name',
            'Copy App api_id and App api_hash into the fields here',
          ],
        },
      },
      {
        key: API_HASH,
        label: 'API hash',
        kind: 'password',
        secret: true,
        placeholder: '0123456789abcdef…',
      },
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
    available: (host) => !!host.ask,
    async connect(config, host, account) {
      const keys = keysOf(config)
      if (!keys) throw new Error(NO_KEYS)
      const { open } = await import('./connection')
      return open(dial, keys, config, host, account)
    },
    async forget(account, host) {
      const { forget } = await import('./connection')
      const kept = (key: string) => host.secret(secretName('telegram', account, key))
      const keys = keysOf({ [API_ID]: await kept(API_ID), [API_HASH]: await kept(API_HASH) })
      await forget(dial, keys, account, host)
      for (const key of [API_ID, API_HASH])
        await host.keepSecret(secretName('telegram', account, key), null)
    },
  }
}
