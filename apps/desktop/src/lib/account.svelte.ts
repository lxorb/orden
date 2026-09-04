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

  /** Raised while a fresh sign-in waits for the question about the notes
   *  already on this machine. Syncing holds off until it is answered: a pass
   *  that ran meanwhile would upload the very notes about to be erased, and
   *  adopt the account's spaces into the list that erasing then deletes. */
  settling = $state(false)

  readonly signedIn = $derived(!!this.token && !!this.user)
  /** When syncing may run: signed in, and not waiting on that question. */
  readonly syncable = $derived(this.signedIn && !this.settling)

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

      // Before the session exists, so whatever starts syncing on sign-in
      // finds the wait already in place.
      this.settling = true
      this.token = token
      this.user = user
      this.open = false
      this.step = 'email'
      this.email = ''

      await this.loadSpaces()
      return true
    } catch (error) {
      // A session that came this far is kept; only the question is dropped,
      // since nobody is going to ask it now.
      this.settling = false
      this.error = error instanceof ApiError ? error.message : 'could not reach the server'
      return false
    } finally {
      this.busy = false
    }
  }

  /** The notes already on this machine have been dealt with, one way or the
   *  other. Syncing has been waiting on this. */
  settled() {
    this.settling = false
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
    this.settling = false
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
