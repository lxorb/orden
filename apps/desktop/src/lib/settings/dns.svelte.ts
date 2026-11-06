import { invoke } from '../tauri'

interface Said {
  choice: string
  custom: string
}

export const PROVIDER_NAMES = {
  cloudflare: 'Cloudflare (1.1.1.1)',
  google: 'Google (Public DNS)',
  quad9: 'Quad9 (9.9.9.9)',
} as const

class Dns {
  offered = $state(false)
  answered = $state(false)
  choice = $state('automatic')
  custom = $state('')
  refused = $state<string | null>(null)

  private asked: Promise<void> | null = null

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
