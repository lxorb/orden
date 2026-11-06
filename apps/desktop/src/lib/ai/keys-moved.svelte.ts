import { isDesktop, platform } from '../tauri'
import { keepJson, stored } from '../stored'
import { hasKey } from './keys'
import { ai } from './store.svelte'

const KEY = 'nib:keys-moved'

const KEYED = new Set(['anthropic', 'openai', 'chatgpt'])

class KeysMoved {
  showing = $state(false)

  async check(): Promise<boolean> {
    if (!isDesktop || platform() !== 'macos' || stored(KEY) === true) return false
    const keyed = ai.providers.filter((one) => KEYED.has(one.kind))
    let missing = false
    for (const one of keyed) {
      if (one.kind === 'chatgpt') {
        const { invoke } = await import('../tauri')
        missing ||= (await invoke<unknown>('chatgpt_account').catch(() => null)) === null
      } else {
        missing ||= !(await hasKey(one.id).catch(() => true))
      }
    }
    keepJson(KEY, true)
    this.showing = missing
    return missing
  }

  dismiss(): void {
    this.showing = false
  }
}

export const keysMoved = new KeysMoved()
