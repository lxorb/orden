import { api, type KeyState } from '../api'
import { account } from '../account.svelte'

class GlassesKey {
  set = $state(false)
  tail = $state('')

  took(state: KeyState | undefined): void {
    if (!state) return

    this.set = state.set
    this.tail = state.tail
  }

  async put(key: string): Promise<string> {
    const token = account.accountToken
    if (!token) return 'sign in first'

    try {
      this.took(await api.setAskKey(token, key.trim()))
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : 'that key could not be saved'
    }
  }

  async remove(): Promise<void> {
    const token = account.accountToken
    if (!token) return

    try {
      this.took(await api.removeAskKey(token))
    } catch {
      // Nothing to say: the field still shows the key as set, which is the truth.
    }
  }
}

export const glassesKey = new GlassesKey()
