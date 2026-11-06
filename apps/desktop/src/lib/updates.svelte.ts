import { keep, storedText } from './stored'
import { isDesktop } from './tauri'
import {
  announcedVersion,
  asChannel,
  type Channel,
  discard,
  managedBy,
  hearHandedOn,
  stageUpdate,
  stagedVersion,
  updatedBySystem,
} from './updater'

const EVERY = 6 * 60 * 60 * 1000

const TICK = 10 * 60 * 1000

const CHANNEL_KEY = 'nib:channel'

function keepChannel(channel: Channel) {
  keep(CHANNEL_KEY, channel)
}

const TOLD_KEY = 'nib:update-told'

const QUIET = 5000

class Updates {
  ready = $state<string | null>(null)

  managed = $state(false)

  system = $state(false)

  channel = $state<Channel>(
    __APP_VERSION__.includes('-') ? 'unstable' : asChannel(storedText(CHANNEL_KEY)),
  )

  private lookedAt = 0
  private running: { stream: number; done: Promise<void> } | null = null
  private stream = 0
  private typedAt = 0
  private waiting: ReturnType<typeof setTimeout> | undefined

  start(): () => void {
    if (!isDesktop) return () => undefined

    void this.look()

    const timer = setInterval(() => void this.lookIfDue(), TICK)
    const returned = () => void this.lookIfDue()
    const typed = () => (this.typedAt = Date.now())
    const stopHearing = hearHandedOn(() => void this.look())

    window.addEventListener('focus', returned)
    window.addEventListener('keydown', typed, true)

    return () => {
      clearInterval(timer)
      clearTimeout(this.waiting)
      stopHearing()
      window.removeEventListener('focus', returned)
      window.removeEventListener('keydown', typed, true)
    }
  }

  private async lookIfDue() {
    if (Date.now() - this.lookedAt < EVERY) return
    await this.look()
  }

  async check() {
    await this.look()
    const waiting = stagedVersion() ?? announcedVersion()
    if (waiting) this.show(waiting)
  }

  look(): Promise<void> {
    const stream = this.stream
    const before = this.running
    if (before?.stream === stream) return before.done

    const made = before ? before.done.then(() => this.lookOn(stream)) : this.lookOn(stream)
    const done: Promise<void> = made.finally(() => {
      if (this.running?.done === done) this.running = null
    })
    this.running = { stream, done }
    return done
  }

  private async lookOn(stream: number) {
    if (this.stream !== stream) return

    this.lookedAt = Date.now()
    const found = await stageUpdate(this.channel)
    if (this.stream !== stream) {
      await discard()
      return
    }

    const manager = await managedBy()
    this.managed = manager !== null
    this.system = updatedBySystem(manager)
    if (this.managed && !this.system && storedText(TOLD_KEY) === found) return

    if (found) this.offer(found)
  }

  setChannel(channel: Channel) {
    if (channel === this.channel) return

    this.channel = channel
    keepChannel(channel)
    this.stream++
    this.dismiss()
    void discard().then(() => this.look())
  }

  private offer(version: string) {
    const since = Date.now() - this.typedAt
    if (since >= QUIET) {
      this.show(version)
      return
    }

    clearTimeout(this.waiting)
    this.waiting = setTimeout(() => this.offer(version), QUIET - since)
  }

  private show(version: string) {
    clearTimeout(this.waiting)
    this.ready = version
    if (this.managed && !this.system) keep(TOLD_KEY, version)
  }

  dismiss() {
    clearTimeout(this.waiting)
    this.ready = null
  }
}

export const updates = new Updates()
