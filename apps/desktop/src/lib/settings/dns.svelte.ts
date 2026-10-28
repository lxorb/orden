/** Settings › General › DNS (#766, #767): which DNS the web tabs' pages look names up
 *  with. Chromium's own Secure DNS, so the crate keeps it and tells the engine
 *  (src-tauri/src/secure_dns.rs); the change holds at once, for every page. */

import { invoke } from '../tauri'

/** What the crate keeps; see `Dns` in secure_dns.rs. */
interface Said {
  choice: string
  custom: string
}

/** The providers the list names, by their own names, which no language translates. */
export const PROVIDER_NAMES = {
  cloudflare: 'Cloudflare (1.1.1.1)',
  google: 'Google (Public DNS)',
  quad9: 'Quad9 (9.9.9.9)',
} as const

class Dns {
  /** Whether this engine can be told at all; Orden's own Chromium only. Not known until
   *  the crate has answered, and the group is left out until then. */
  offered = $state(false)
  /** Whether the crate has answered, so a desktop whose engine cannot be told says so
   *  rather than showing nothing. */
  answered = $state(false)
  choice = $state('automatic')
  custom = $state('')
  /** Why the last address typed was not taken, or nothing. */
  refused = $state<string | null>(null)

  private asked: Promise<void> | null = null

  /** Asks the crate once; settled once it has answered. */
  ask(): Promise<void> {
    this.asked ??= invoke<Said | null>('dns_chosen')
      .then((said) => {
        this.answered = true
        if (!said) return
        this.choice = said.choice
        this.custom = said.custom
        this.offered = true
      })
      .catch(() => undefined)
    return this.asked
  }

  async choose(choice: string) {
    this.choice = choice
    await this.tell()
  }

  async provide(address: string) {
    this.custom = address.trim()
    await this.tell()
  }

  private async tell() {
    try {
      await invoke('dns_choose', { dns: { choice: this.choice, custom: this.custom } })
      this.refused = null
    } catch (error) {
      this.refused = String(error)
    }
  }
}

export const dns = new Dns()
