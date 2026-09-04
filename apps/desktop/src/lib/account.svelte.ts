import { api, ApiError, type Account, type RemoteSpace } from './api'

const STORAGE_KEY = 'nib:session'

export type Step = 'email' | 'code'

class Session {
  token = $state<string | null>(null)
  user = $state<Account | null>(null)
  spaces = $state<RemoteSpace[]>([])
  /** Ids the account says were deleted, so a machine that was away can tell
   *  that apart from a space it has simply not uploaded yet. */
  deletedSpaces = $state<string[]>([])

  /** Sign-in dialog state. One surface serves both signing in and signing up. */
  open = $state(false)
  step = $state<Step>('email')
  email = $state('')
  error = $state<string | null>(null)
  busy = $state(false)
  resendIn = $state(0)

  readonly signedIn = $derived(!!this.token && !!this.user)

  async restore() {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return

    this.token = saved
    try {
      this.user = (await api.me(saved)).user
      await this.loadSpaces()
    } catch {
      // An expired or revoked token is just a signed-out state.
      this.forget()
    }
  }

  async requestCode() {
    const address = this.email.trim()
    if (!address) return

    this.busy = true
    this.error = null

    try {
      const { resendIn } = await api.requestCode(address)
      this.step = 'code'
      this.startResendTimer(resendIn)
    } catch (error) {
      this.error = error instanceof ApiError ? error.message : 'could not reach the server'
    } finally {
      this.busy = false
    }
  }

  /** Resolves true when the code was accepted, so the caller can reset the form. */
  async verify(code: string): Promise<boolean> {
    this.busy = true
    this.error = null

    try {
      const { token, user } = await api.verifyCode(this.email.trim(), code)
      localStorage.setItem(STORAGE_KEY, token)

      this.token = token
      this.user = user
      this.open = false
      this.step = 'email'
      this.email = ''

      await this.loadSpaces()
      return true
    } catch (error) {
      this.error = error instanceof ApiError ? error.message : 'could not reach the server'
      return false
    } finally {
      this.busy = false
    }
  }

  async signOut() {
    const token = this.token
    this.forget()
    if (token) await api.signOut(token).catch(() => undefined)
  }

  /** The name shown on anything the account publishes. Throws on refusal,
   *  so the pane asking can say why. */
  async rename(name: string) {
    if (!this.token) return
    this.user = (await api.rename(this.token, name)).user
  }

  async loadSpaces() {
    if (!this.token) return
    const listed = await api.listSpaces(this.token)
    this.spaces = listed.spaces
    this.deletedSpaces = listed.deleted ?? []
  }

  private forget() {
    localStorage.removeItem(STORAGE_KEY)
    this.token = null
    this.user = null
    this.spaces = []
    this.deletedSpaces = []
  }

  private startResendTimer(seconds: number) {
    this.resendIn = seconds
    const tick = setInterval(() => {
      this.resendIn -= 1
      if (this.resendIn <= 0) clearInterval(tick)
    }, 1000)
  }
}

export const account = new Session()
