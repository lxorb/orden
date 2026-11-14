import { keep, storedText } from './platform/src/api'

const KEY = 'orden:renamed'

function usedBefore(): boolean {
  try {
    for (let at = 0; at < localStorage.length; at++) {
      const key = localStorage.key(at)
      if (key !== null && key !== KEY && key.startsWith('orden:')) return true
    }
  } catch {
    // No site data allowed: nothing is remembered, so nothing is said every run.
  }
  return false
}

class Renamed {
  showing = $state(false)

  constructor() {
    if (storedText(KEY) !== null) return
    this.showing = usedBefore()
    keep(KEY, 'told')
  }

  dismiss() {
    this.showing = false
  }
}

export const renamed = new Renamed()
