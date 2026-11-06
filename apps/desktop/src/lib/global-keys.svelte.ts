import { t } from './i18n.svelte'
import { invoke, isDesktop } from './tauri'

export interface GlobalKeys {
  reach: 'system' | 'portal' | 'none'
  change: boolean
  held: Record<string, string>
  refused: string[]
  run: string
}

const FLAGS: Readonly<Record<string, string>> = {
  'app.quick-add': '--quick-add',
  'agents.stop': '--stop-agents',
}

export interface Note {
  text: string
  change: boolean
}

const plain = (key: string) =>
  key
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/control/g, 'ctrl')
    .replace(/logo|meta|win/g, 'super')

export function noteFor(keys: GlobalKeys | null, id: string, shown: string | null): Note | null {
  const flag = FLAGS[id]
  if (!keys || !flag || keys.reach === 'system') return null
  if (keys.reach === 'none') {
    return {
      text: t('From other apps: bind {command} in your system settings', {
        command: `${keys.run} ${flag}`,
      }),
      change: false,
    }
  }
  const given = keys.held[id]
  if (keys.refused.includes(id) || given === '') {
    return { text: t('From other apps: set in your system settings'), change: keys.change }
  }
  if (given === undefined || (shown !== null && plain(given) === plain(shown))) return null
  return { text: t('From other apps: {key}', { key: given }), change: keys.change }
}

class Global {
  keys = $state<GlobalKeys | null>(null)
  #asked = false

  follow() {
    if (this.#asked || !isDesktop) return
    this.#asked = true
    void invoke<GlobalKeys>('global_keys')
      .then((keys) => (this.keys = keys))
      .catch(() => undefined)
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<GlobalKeys>('nib://global-keys', (event) => (this.keys = event.payload)),
    )
  }

  change() {
    void invoke('global_keys_change').catch(() => undefined)
  }
}

export const globalKeys = new Global()
