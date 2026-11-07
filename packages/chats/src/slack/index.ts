import type { ChatProvider } from '../provider'
import type { Deps } from './connection'

export type { Deps } from './connection'
export type { Dial, Line, LineEvents } from './socket'
export { CLIENT_ID, SERVER, USER_SCOPES } from './oauth'

const ICON =
  'M5.04 15.17a2.53 2.53 0 1 1-2.52-2.53h2.52zm1.27 0a2.53 2.53 0 0 1 5.05 0v6.3a2.53 2.53 0 1 1-5.05 0zM8.83 5.04a2.53 2.53 0 1 1 2.53-2.52v2.52zm0 1.27a2.53 2.53 0 0 1 0 5.05H2.52a2.53 2.53 0 0 1 0-5.05zm10.13 2.52a2.53 2.53 0 1 1 2.52 2.53h-2.52zm-1.27 0a2.53 2.53 0 0 1-5.05 0V2.52a2.53 2.53 0 1 1 5.05 0zm-2.52 10.13a2.53 2.53 0 1 1-2.53 2.52v-2.52zm0-1.27a2.53 2.53 0 0 1 0-5.05h6.31a2.53 2.53 0 0 1 0 5.05z'

const MOST_FILE = 1024 * 1024 * 1024

export function slackProvider(deps: Deps = {}): ChatProvider {
  return {
    id: 'slack',
    name: 'Slack',
    icon: ICON,
    fields: [
      {
        key: 'token',
        label: 'User token',
        kind: 'password',
        secret: true,
        optional: true,
        placeholder: 'xoxp-…',
        note: 'Leave it empty to sign in through the browser, or paste the user token of your own Slack app',
      },
      {
        key: 'appToken',
        label: 'App-level token',
        kind: 'password',
        secret: true,
        optional: true,
        placeholder: 'xapp-…',
        note: 'Optional: with Socket Mode on in your own app, messages arrive at once',
      },
    ],
    can: {
      send: true,
      attachments: true,
      live: true,
      replies: false,
      threads: true,
      reactions: 'any',
      receipts: false,
      presence: true,
      maxFile: MOST_FILE,
      formatting: 'markdown',
    },
    available: (host) => typeof host.fetch === 'function',
    async connect(config, host, account) {
      const { open } = await import('./connection')
      return open(config, host, account, deps)
    },
    async forget(account, host) {
      const { forget } = await import('./connection')
      await forget(account, host)
    },
  }
}
