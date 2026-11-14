import { keepJson, stored } from '../../platform/src/api'

export const HELP_IMPROVE = 'orden:usage-help'
export const INSTALL_ID = 'orden:usage-install'
export const USAGE_DAYS = 'orden:usage-days'
export const USAGE_QUEUE = 'orden:usage-queue'
export const USAGE_PINGED = 'orden:usage-pinged'

function freshInstall(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((one) => one.toString(16).padStart(2, '0')).join('')
}

class UsageChoice {
  helping = $state(stored(HELP_IMPROVE) === true)

  readonly changes = new Set<() => void>()

  setHelping(on: boolean): void {
    this.helping = on
    keepJson(HELP_IMPROVE, on)
    if (!on) {
      keepJson(INSTALL_ID, null)
      keepJson(USAGE_DAYS, {})
    }
    for (const one of this.changes) one()
  }

  install(): string {
    const kept = stored(INSTALL_ID)
    if (typeof kept === 'string' && /^[0-9a-f]{32}$/.test(kept)) return kept
    const made = freshInstall()
    keepJson(INSTALL_ID, made)
    return made
  }
}

export const usageChoice = new UsageChoice()
