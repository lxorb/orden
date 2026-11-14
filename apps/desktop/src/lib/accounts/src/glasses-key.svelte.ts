import { account } from './account.svelte'
import { api } from './client'
import type { KeyState } from './routes'

class GlassesKey {
  set = $state(false)
  tail = $state('')
  private heard = false

  forget(): void {
    this.set = false
    this.tail = ''
  }

  took(state: KeyState | undefined): void {
    if (!state) return

    if (!this.heard) account.forgetWithSession(() => this.forget())
    this.heard = true
    this.set = state.set
    this.tail = state.tail
  }

  async put(key: string): Promise<string> {
    const token = account.accountToken
    if (!token) return 'sign in first'

    try {
      const state = await api.setAskKey(token, key.trim())
      if (account.accountToken !== token) return 'sign in first'
      this.took(state)
      return ''
    } catch (error) {
      if (account.accountToken !== token) return 'sign in first'
      return error instanceof Error ? error.message : 'that key could not be saved'
    }
  }

  async remove(): Promise<void> {
    const token = account.accountToken
    if (!token) return

    try {
      const state = await api.removeAskKey(token)
      if (account.accountToken === token) this.took(state)
    } catch {
      // Nothing to say: the field still shows the key as set, which is the truth.
    }
  }
}

export const glassesKey = new GlassesKey()
