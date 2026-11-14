import { api } from './accounts/src/api'
import { account } from './accounts/src/api'

export const NEARLY_FULL = 0.9

class Usage {
  used = $state(0)
  limit = $state(0)
  dismissed = $state(false)
  full = $state(false)

  readonly fraction = $derived(this.limit ? this.used / this.limit : 0)
  readonly nearlyFull = $derived(this.limit > 0 && this.fraction >= NEARLY_FULL)
  readonly warning = $derived((this.nearlyFull || this.full) && !this.dismissed)

  syncFull(full: boolean) {
    if (full === this.full) return
    this.full = full
    if (!full) return
    this.dismissed = false
    void this.refresh()
  }

  async refresh() {
    const token = account.accountToken
    if (!token) {
      this.used = 0
      this.limit = 0
      return
    }

    try {
      const { used, limit } = await api.usage(token)
      if (limit && used / limit > this.fraction) this.dismissed = false

      this.used = used
      this.limit = limit
    } catch {
      // Not worth an error of its own: the number is informational, and the
      // server refuses anything over the limit whatever this says.
    }
  }
}

export const usage = new Usage()

account.forgetWithSession(() => {
  usage.used = 0
  usage.limit = 0
  usage.dismissed = false
  usage.full = false
})

export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
