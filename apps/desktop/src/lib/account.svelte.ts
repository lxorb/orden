import { api, ApiError, fromServer, type Account, type Guest, type RemoteSpace } from './api'
import { arriving } from './arriving.svelte'
import { pollDelay } from './backoff'
import { called } from './person'
import { forget, keep, storedText } from './stored'
import { waited } from './timing'

const STORAGE_KEY = 'orden:session'

export type Step = 'email' | 'code' | 'second'

export type Leaving = 'asked' | 'told' | 'kept'

export interface Vault {
  read(): Promise<string | null>
  write(token: string): Promise<void>
  clear(): Promise<void>
}

const TRIES = [400, 1200, 2500]

function rejected(error: unknown): boolean {
  return fromServer(error) && error.status === 401
}

function statusOf(error: unknown): number | null {
  return error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : null
}

class Session {
  token = $state<string | null>(null)
  user = $state<Account | null>(null)
  guest = $state<Guest | null>(null)
  spaces = $state<RemoteSpace[]>([])
  listed = $state(false)
  deletedSpaces = $state<string[]>([])

  open = $state(false)

  ask() {
    this.open = true
  }
  step = $state<Step>('email')
  email = $state('')
  error = $state<string | null>(null)
  busy = $state(false)
  resendIn = $state(0)

  private holding: string | null = null

  settling = $state(false)

  restoring = $state(false)

  private lookedFor: () => void = () => undefined

  readonly looked = new Promise<void>((done) => {
    this.lookedFor = done
  })

  readonly signedIn = $derived(!!this.token && (!!this.user || !!this.guest))
  readonly accountToken = $derived(this.user ? this.token : null)
  readonly name = $derived(this.user ? called(this.user) : (this.guest?.name ?? null))
  readonly syncable = $derived(this.signedIn && !this.settling)

  private vault: Vault | null = null

  alsoKeepIn(vault: Vault) {
    this.vault = vault
  }

  private readonly alsoForget = new Set<(kept: boolean) => void>()

  forgetWithSession(clear: (kept: boolean) => void) {
    this.alsoForget.add(clear)
  }

  private mayLeave: () => Promise<boolean> = () => Promise.resolve(true)

  askBeforeLeaving(ask: () => Promise<boolean>) {
    this.mayLeave = ask
  }

  async restore() {
    this.restoring = true
    try {
      await this.lookForSession()
    } finally {
      this.restoring = false
      this.lookedFor()
    }
  }

  private async lookForSession() {
    const saved = (await this.vault?.read()) ?? storedText(STORAGE_KEY)
    if (!saved) return

    keep(STORAGE_KEY, saved)
    this.token = saved
    this.lookedFor()

    for (const pause of [0, ...TRIES]) {
      if (pause) await waited(pause)
      if (await this.asked(saved)) return
    }
    this.askLater(saved)
  }

  private async asked(token: string): Promise<boolean> {
    try {
      const who = await api.me(token)
      if (this.token !== token) return true
      this.user = who.user ?? null
      this.guest = who.guest ?? null
    } catch (error) {
      if (!rejected(error)) return false
      if (this.token === token) this.forget()
      return true
    }
    await this.loadSpaces().catch(() => undefined)
    return true
  }

  async recheck(): Promise<void> {
    const token = this.token
    if (token) await this.asked(token)
  }

  signedOutBy(error: unknown): boolean {
    if (statusOf(error) !== 401) return false
    void this.recheck()
    return true
  }

  async reread(): Promise<void> {
    const token = this.token
    if (!token || !this.user) return
    const who = await api.me(token).catch(() => null)
    if (this.token !== token || !who?.user) return
    this.user = who.user
  }

  async requestCode() {
    const address = this.email.trim()
    if (!address || this.busy) return

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

  async code(digits: string): Promise<boolean> {
    return this.step === 'second' ? this.second(digits) : this.verify(digits)
  }

  async verify(code: string): Promise<boolean> {
    this.busy = true
    this.error = null

    const held = this.guest ? this.token : null

    let session
    try {
      session = await api.verifyCode(this.email.trim(), code, held ?? undefined)
    } catch (error) {
      this.error = error instanceof ApiError ? error.message : 'could not reach the server'
      return false
    } finally {
      this.busy = false
    }

    if (session.second && session.holding) {
      this.askForSecond(session.holding)
      return false
    }

    const { token, user } = session
    if (!token || !user) {
      this.error = 'that code is not right'
      return false
    }

    await this.settleIn(token, user)
    return true
  }

  askForSecond(holding: string) {
    this.holding = holding
    this.error = null
    this.step = 'second'
    this.open = true
  }

  private async settleIn(token: string, user: Account): Promise<void> {
    this.guest = null
    keep(STORAGE_KEY, token)
    void this.vault?.write(token).catch(() => undefined)
    this.stopResendTimer()

    this.settling = true
    this.token = token
    this.user = user
    this.open = false
    this.step = 'email'
    this.email = ''

    arriving.begin()
    void import('./web/kept-for-good.svelte').then((one) => one.keptForGood.ask())

    await this.loadSpaces().catch(() => undefined)
  }

  async second(code: string): Promise<boolean> {
    if (!this.holding) return false

    this.busy = true
    this.error = null

    let session
    try {
      session = await api.verifySecond(this.holding, code)
    } catch (error) {
      this.error = error instanceof ApiError ? error.message : 'could not reach the server'
      return false
    } finally {
      this.busy = false
    }

    this.holding = null
    await this.settleIn(session.token, session.user)
    return true
  }

  async arrive(token: string, who: { user?: Account; guest?: Guest }) {
    this.stopResendTimer()
    keep(STORAGE_KEY, token)
    void this.vault?.write(token).catch(() => undefined)

    if (who.user) this.settling = true
    this.token = token
    this.user = who.user ?? null
    this.guest = who.guest ?? null
    this.open = false
    this.step = 'email'
    this.email = ''

    arriving.begin()
    await this.loadSpaces().catch(() => undefined)
  }

  settled() {
    this.settling = false
  }

  async signOut(how: Leaving = 'told') {
    if (how === 'asked' && this.user && !(await this.mayLeave())) return
    const token = this.token
    this.forget(how === 'kept')
    if (token) await api.signOut(token).catch(() => undefined)
  }

  async rename(name: string) {
    if (!this.token) return

    const who = await api.rename(this.token, name)
    if (who.user) this.user = who.user
    if (who.guest) this.guest = who.guest
  }

  async loadSpaces() {
    if (!this.token) return
    const listed = await api.listSpaces(this.token)
    this.spaces = listed.spaces
    this.deletedSpaces = listed.deleted
    this.listed = true

    const { rememberRoles, sharedWithYou } = await import('./sharing.svelte')
    rememberRoles()
    await sharedWithYou.load()

    await (await import('./space-archive')).listed()
  }

  private asking?: ReturnType<typeof setTimeout>

  private askLater(token: string, tries = 0) {
    clearTimeout(this.asking)
    this.asking = setTimeout(
      () => {
        if (this.token !== token || this.user || this.guest) return
        void this.asked(token).then((done) => done || this.askLater(token, tries + 1))
      },
      pollDelay(tries, false),
    )
  }

  private forget(kept = false) {
    clearTimeout(this.asking)
    arriving.reset()
    forget(STORAGE_KEY)
    void this.vault?.clear().catch(() => undefined)
    this.stopResendTimer()
    this.token = null
    this.user = null
    this.guest = null
    this.holding = null
    this.settling = false
    this.spaces = []
    this.deletedSpaces = []
    this.listed = false
    for (const clear of this.alsoForget) clear(kept)
  }

  private resendTimer: ReturnType<typeof setInterval> | undefined

  private startResendTimer(seconds: number) {
    this.stopResendTimer()
    this.resendIn = seconds

    this.resendTimer = setInterval(() => {
      this.resendIn -= 1
      if (this.resendIn <= 0) this.stopResendTimer()
    }, 1000)
  }

  private stopResendTimer() {
    clearInterval(this.resendTimer)
    this.resendTimer = undefined
  }
}

export const account = new Session()
