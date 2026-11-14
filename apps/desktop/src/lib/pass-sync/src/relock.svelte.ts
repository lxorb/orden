import { isDesktop } from '../../platform/src/api'
import type { RelockAfter } from './settings'

export class Relock {
  private timer: ReturnType<typeof setTimeout> | null = null
  private watching = false
  private readonly after: () => RelockAfter
  private readonly lock: () => void

  constructor(after: () => RelockAfter, lock: () => void) {
    this.after = after
    this.lock = lock
  }

  away(): void {
    this.back()
    const minutes = this.after()
    if (minutes === 0) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.lock()
    }, minutes * 60_000)
  }

  back(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  watch(): void {
    if (this.watching || typeof document === 'undefined') return
    this.watching = true
    document.addEventListener('visibilitychange', () =>
      document.visibilityState === 'hidden' ? this.away() : this.back(),
    )
    if (!isDesktop) {
      window.addEventListener('blur', () => this.away())
      window.addEventListener('focus', () => this.back())
      return
    }
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload }) => (payload ? this.back() : this.away())),
      )
      .catch(() => undefined)
  }
}
