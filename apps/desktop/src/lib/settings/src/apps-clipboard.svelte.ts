import { keep, storedText } from '../../platform/src/api'

const KEY = 'orden:apps-clipboard'

class ClipboardSharing {
  on = $state(storedText(KEY) !== 'no')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'yes' : 'no')
  }

  heard() {
    this.on = storedText(KEY) !== 'no'
  }
}

export const clipboardSharing = new ClipboardSharing()

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) clipboardSharing.heard()
  })
}
