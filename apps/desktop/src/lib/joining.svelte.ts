import { api, ApiError, fromServer, type Invitation, type Joined } from './api'
import { account } from './account.svelte'
import { passing, pollDelay } from './backoff'
import { message, t } from './i18n.svelte'
import { deviceName } from './rooms/who'
import { forget, keep, storedText } from './stored'
import { sync } from './sync.svelte'
import { workspace } from './workspace.svelte'

const PATH = /^\/join\/([a-f0-9]{16,128})$/

const WAITING_KEY = 'orden:waiting'

const ASK_EVERY = 3000

const QUICK_ASKS = 40

function askDelay(asked: number, hidden: boolean): number {
  if (asked < QUICK_ASKS && !hidden) return ASK_EVERY
  return pollDelay(Math.max(0, asked - QUICK_ASKS), hidden)
}

export type Step = 'asking' | 'waiting' | 'declined' | 'gone' | 'unreached'

function said(text: string): { name: string } | { email: string } {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text) ? { email: text } : { name: text }
}

function refused(error: unknown): boolean {
  return fromServer(error) && error.status >= 400 && !passing(error.status)
}

class Joining {
  invitation = $state<Invitation | null>(null)
  step = $state<Step | null>(null)
  told = $state('')
  busy = $state(false)
  error = $state<string | null>(null)
  closed = $state(false)

  get aside(): boolean {
    return this.closed && (this.step === 'asking' || this.step === 'waiting')
  }

  get shown(): boolean {
    return this.step !== null && !this.aside
  }

  private token: string | null = null
  private asking: ReturnType<typeof setTimeout> | undefined
  private asks = 0

  async start() {
    const found = PATH.exec(window.location.pathname)
    if (!found?.[1]) return this.resume()

    this.token = found[1]
    window.history.replaceState(null, '', '/')
    await this.open(this.token)
  }

  async retry() {
    const token = this.token
    if (this.step !== 'unreached' || !token || this.busy) return
    this.error = null
    if (this.invitation) await this.walkThrough()
    else await this.open(token)
  }

  private async open(token: string) {
    this.busy = true
    let invitation: Invitation
    try {
      invitation = await api.invitation(token)
    } catch (error) {
      if (this.token !== token) return
      if (refused(error)) this.ranOut()
      else this.unreached(error)
      return
    } finally {
      this.busy = false
    }
    if (this.token !== token) return
    this.invitation = invitation

    if (this.invitation.asks && !account.signedIn) {
      this.step = 'asking'
      return
    }

    await this.walkThrough()
  }

  private async resume() {
    const held = storedText(WAITING_KEY)
    if (!held || !PATH.test(`/join/${held}`) || !account.signedIn) {
      if (account.guest) await (await import('./one-file')).backToTheFile()
      return
    }

    this.token = held
    this.closed = true
    this.step = 'waiting'
    this.invitation = await api.invitation(held).catch(() => null)
    await this.walkThrough()
  }

  async tell() {
    if (!this.told.trim()) return
    await this.walkThrough()
  }

  async walkThrough() {
    const token = this.token
    const again = this.step === 'waiting'
    if (!token || this.busy) return

    this.busy = true
    this.error = null

    let joined: Joined
    try {
      joined = await api.join(token, {
        ...(account.token ? { token: account.token } : {}),
        device: deviceName('Browser'),
        ...(this.told.trim() ? said(this.told.trim()) : {}),
        ...(again ? { again } : {}),
      })
    } catch (error) {
      if (this.token !== token) return
      if (!refused(error)) {
        this.error = message(error, t('could not reach the server'))
        if (this.step === 'waiting') {
          if (!this.asking) this.later()
        } else if (this.step !== 'asking') this.step = 'unreached'
        return
      }

      this.error = message(error, t('Ask for another one.'))
      this.stopAsking()
      this.closed = false
      this.step = 'gone'
      return
    } finally {
      this.busy = false
    }

    if (this.token !== token) return
    await this.landed(joined)
  }

  private async landed(joined: Joined) {
    if (joined.second && joined.holding) {
      account.askForSecond(joined.holding)
      return
    }

    if (joined.token) await account.arrive(joined.token, joined)
    else if (joined.guest) account.guest = joined.guest

    if (joined.user) await (await import('./settling')).settleLocalNotes()

    if (joined.waiting) {
      this.wait()
      return
    }

    if (joined.declined) {
      this.stopAsking()
      this.closed = false
      this.step = 'declined'
      return
    }

    if (joined.item) {
      this.stopAsking()
      await (await import('./one-file')).landOn(joined.item)
      this.arrived()
      return
    }

    const space = joined.space
    if (!space) return

    this.arrived()

    await account.loadSpaces().catch(() => undefined)
    await sync.pass()

    const here = workspace.spaces.find((one) => sync.remoteIdFor(one.root) === space.id)
    if (here) await workspace.showSpace(here.id)
  }

  private arrived() {
    this.stopAsking()
    this.step = null
    this.closed = false
    this.token = null
    this.invitation = null
  }

  private wait() {
    if (this.step !== 'waiting') this.asks = 0
    this.step = 'waiting'
    if (this.token) keep(WAITING_KEY, this.token)
    if (!this.asking) this.later()
  }

  private laterOnce() {
    if (!this.asking) this.later()
  }

  private later() {
    const page = typeof document === 'undefined' ? null : document
    if (page && !this.watching) page.addEventListener('visibilitychange', this.seen)
    this.watching = page
    this.asking = setTimeout(
      () => this.askNow(),
      askDelay(this.asks, page?.visibilityState === 'hidden'),
    )
  }

  private askNow() {
    clearTimeout(this.asking)
    this.asking = undefined
    this.asks += 1
    void this.walkThrough().finally(() => {
      if (this.step === 'waiting' && !this.asking) this.later()
    })
  }

  private readonly seen = () => {
    if (this.watching?.visibilityState === 'visible' && this.asking) this.askNow()
  }

  private watching: Document | null = null

  private stopAsking() {
    clearTimeout(this.asking)
    this.asking = undefined
    this.watching?.removeEventListener('visibilitychange', this.seen)
    this.watching = null
    forget(WAITING_KEY)
  }

  private ranOut() {
    this.token = null
    this.step = 'gone'
  }

  private unreached(error: unknown) {
    this.error = message(error, t('could not reach the server'))
    this.step = 'unreached'
  }

  close() {
    this.closed = true
  }

  reopen() {
    this.closed = false
  }

  async cancel() {
    const token = this.token
    if (this.step === 'waiting' && token && account.token) {
      clearTimeout(this.asking)
      this.asking = undefined
      try {
        await api.withdraw(token, account.token)
      } catch (error) {
        if (this.token !== token) return
        if (!(error instanceof ApiError && error.status === 404)) {
          this.error = message(error, t('Try again'))
          this.closed = false
          this.laterOnce()
          return
        }
      }
      if (this.token !== token) return
    }
    this.dismiss()
  }

  dismiss() {
    this.stopAsking()
    this.closed = false
    this.step = null
    this.token = null
    this.invitation = null
    this.error = null
    this.told = ''
  }
}

export const joining = new Joining()

account.forgetWithSession(() => joining.dismiss())
