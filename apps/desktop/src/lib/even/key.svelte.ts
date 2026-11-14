import { api, type KeyState } from '../accounts/src/api'
import { account } from '../accounts/src/api'

class GlassesKey {
  set = $state(false)
  tail = $state('')

  forget(): void {
    this.set = false
    this.tail = ''
  }

  took(state: KeyState | undefined): void {
    if (!state) return

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

account.forgetWithSession(() => glassesKey.forget())
