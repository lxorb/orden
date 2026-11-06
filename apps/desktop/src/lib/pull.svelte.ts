import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { runnable } from './shortcuts/registry'
import { viewport } from './viewport.svelte'
import { forget, isString, keep, storedText } from './stored'

const STORAGE_KEY = 'nib:pull'

export const DEFAULT_PULL = 'app.refresh'

const WAITS = 15_000

export const NOTHING = 'none'

export const CLAIM = 12

export const REACH = 84

const MOST = REACH * 1.4

export function claimsPull(dx: number, dy: number): boolean {
  return dy >= CLAIM && dy > Math.abs(dx) * 1.6
}

export function pulled(dy: number): number {
  if (dy <= 0) return 0

  const eased = MOST * (1 - 1 / (1 + dy / MOST))
  return Math.min(MOST, Math.round(eased * 1.6))
}

export function armed(distance: number): boolean {
  return distance >= REACH
}

class Pull {
  at = $state(0)

  refreshing = $state(false)

  failed = $state(false)

  async press(): Promise<void> {
    if (this.id !== DEFAULT_PULL) {
      this.runs?.()
      return
    }
    if (this.refreshing) return
    this.refreshing = true
    this.failed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<boolean>((done) => (timer = setTimeout(() => done(false), WAITS)))
    const ok = await Promise.race([
      import('./refresh')
        .then(({ refreshHere }) => refreshHere())
        .then(
          () => true,
          () => false,
        ),
      late,
    ])
    clearTimeout(timer)
    this.refreshing = false
    if (!ok) {
      this.failed = true
      setTimeout(() => (this.failed = false), 1_600)
    }
  }

  get ready(): boolean {
    return armed(this.at)
  }

  chosen = $state<string | null>(null)

  get id(): string {
    return this.chosen ?? DEFAULT_PULL
  }

  get changed(): boolean {
    return this.chosen !== null
  }

  restore() {
    this.chosen = usable(storedText(STORAGE_KEY))
  }

  choose(id: string) {
    this.chosen = id === DEFAULT_PULL ? null : usable(id)
    if (this.chosen) keep(STORAGE_KEY, this.chosen)
    else forget(STORAGE_KEY)

    this.share()
  }

  receive(remote: AccountSettings) {
    const theirs = remote.pull
    if (theirs === undefined) {
      if (this.chosen) this.share()
      return
    }

    const theirOwn = usable(theirs)
    if (theirOwn === this.chosen) return

    this.chosen = theirOwn
    if (theirOwn) keep(STORAGE_KEY, theirOwn)
    else forget(STORAGE_KEY)
  }

  private share() {
    const token = account.accountToken
    if (!token) return

    void api.saveSettings(token, { pull: this.chosen }).catch(() => undefined)
  }

  runs: (() => void) | null = null

  follow(scroller: HTMLElement): () => void {
    let startX = 0
    let startY = 0
    let candidate = false
    let claimed = false

    const clear = () => {
      candidate = false
      claimed = false
      this.at = 0
    }

    const onStart = (event: TouchEvent) => {
      clear()
      if (this.id === NOTHING) return
      if (event.touches.length !== 1) return

      const touch = event.touches[0]
      if (!touch) return

      if (scroller.scrollTop > 0) return
      if (busyWithWords()) return

      startX = touch.clientX
      startY = touch.clientY
      candidate = true
    }

    const onMove = (event: TouchEvent) => {
      if (!candidate) return

      const touch = event.touches[0]
      if (!touch) return

      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!claimed) {
        if (dy < -2 || Math.abs(dx) > Math.abs(dy)) {
          candidate = false
          return
        }
        if (!claimsPull(dx, dy)) return

        claimed = true
      }

      event.preventDefault()
      this.at = pulled(dy)
    }

    const onEnd = () => {
      const go = claimed && this.ready
      clear()
      if (go) void this.press()
    }

    scroller.addEventListener('touchstart', onStart, { passive: true })
    scroller.addEventListener('touchmove', onMove, { passive: false })
    scroller.addEventListener('touchend', onEnd)
    scroller.addEventListener('touchcancel', clear)

    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
      scroller.removeEventListener('touchcancel', clear)
      clear()
    }
  }
}

function busyWithWords(): boolean {
  if (viewport.typing) return true
  const chosen = typeof document === 'undefined' ? null : document.getSelection()
  return !!chosen && !chosen.isCollapsed
}

export function usable(value: unknown): string | null {
  if (!isString(value)) return null
  if (value === NOTHING) return NOTHING

  return runnable(value) ? value : null
}

export const pull = new Pull()

export function pullable(node: HTMLElement) {
  return { destroy: pull.follow(node) }
}
