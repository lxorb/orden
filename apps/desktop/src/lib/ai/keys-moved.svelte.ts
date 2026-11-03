/** Whether to say, once, that a Mac's AI keys are typed again (#1090).
 *
 *  Orden keeps its secrets on a Mac in a file of its own rather than in the keychain, and
 *  reads nothing from the keychain: so a key an older Orden kept there, and its ChatGPT
 *  sign-in, are not here. A reader who had them is told so once, at the foot of the
 *  window, with the way to Settings › AI; see KeysMoved.svelte and src-tauri/src/secrets.rs.
 *  Asked after the first paint, fetched only by a Mac. */

import { isDesktop, platform } from '../tauri'
import { keep, stored } from '../stored'
import { hasKey } from './keys'
import { ai } from './store.svelte'

const KEY = 'nib:keys-moved'

/** The kinds whose sign-in lived in the keychain: a key, or ChatGPT's refresh token. */
const KEYED = new Set(['anthropic', 'openai', 'chatgpt'])

class KeysMoved {
  showing = $state(false)

  /** Whether this Mac had a provider whose key or sign-in is not here now. Said once. */
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
    keep(KEY, 'true')
    this.showing = missing
    return missing
  }

  dismiss(): void {
    this.showing = false
  }
}

export const keysMoved = new KeysMoved()
