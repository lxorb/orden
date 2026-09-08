import { api } from './api'
import { account } from './account.svelte'

/** Where the warning starts. Close enough that there is time to do something,
 *  far enough that it is not nagging. */
export const NEARLY_FULL = 0.9

/** How much of the account's gigabyte is spoken for. Refreshed after anything
 *  that could have changed it rather than on a timer, so a settings page left
 *  open costs nothing. */
class Usage {
  used = $state(0)
  limit = $state(0)
  /** Dismissed by hand; the warning stays away until the next session or until
   *  usage climbs again. */
  dismissed = $state(false)

  readonly fraction = $derived(this.limit ? this.used / this.limit : 0)
  readonly nearlyFull = $derived(this.limit > 0 && this.fraction >= NEARLY_FULL)
  readonly warning = $derived(this.nearlyFull && !this.dismissed)

  async refresh() {
    const token = account.accountToken
    if (!token) {
      this.used = 0
      this.limit = 0
      return
    }

    try {
      const { used, limit } = await api.usage(token)
      // Climbing further past the line is worth saying again.
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

/** Nothing refreshes these once there is no account to ask about, so without this
 *  the warning in the corner would go on saying how full somebody else's account
 *  was, over an app that is signed out. */
account.forgetWithSession(() => {
  usage.used = 0
  usage.limit = 0
  usage.dismissed = false
})

/** Bytes as something a person reads, in the units they expect from a disk. */
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
