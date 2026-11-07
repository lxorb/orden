import type { ChatProvider } from '../provider'
import type { Deps } from './connection'

export type { Deps } from './connection'
export type { RawStore } from './store'

const ICON =
  'M12 2a10 10 0 0 0-8.6 15.1L2 22l4.9-1.4A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 1 1-4.4 15.1l-.3-.2-2.8.8.8-2.8-.2-.3A8.2 8.2 0 0 1 12 3.8z'

const DAY = 24 * 60 * 60 * 1000
const MOST_FILE = 100 * 1024 * 1024

export function signalProvider(deps: Deps): ChatProvider {
  return {
    id: 'signal',
    name: 'Signal',
    icon: ICON,
    fields: [
      {
        key: 'device',
        label: 'Device name',
        kind: 'text',
        optional: true,
        initial: 'Orden',
        note: 'How this computer is listed under linked devices in Signal',
      },
    ],
    warning:
      'Orden links to Signal as a device through signal-cli, which Signal does not make or endorse. The first time, Orden downloads signal-cli and Java (about 190 MB).',
    can: {
      send: true,
      attachments: true,
      live: true,
      replies: true,
      threads: false,
      editFor: DAY,
      removeFor: DAY,
      removeForMe: true,
      reactions: 'one',
      voice: true,
      polls: true,
      receipts: true,
      presence: false,
      maxFile: MOST_FILE,
      formatting: 'markdown',
    },
    available: (host) => !!host.sidecar && !!host.show && !!host.sealed,
    async connect(config, host, account) {
      const { open } = await import('./connection')
      return open(config, host, account, deps)
    },
    async forget(account, host) {
      const { forget } = await import('./connection')
      await forget(account, host, deps)
    },
  }
}
