import { keep, storedText } from '../../platform/src/api'

const KEY = 'orden:apps-clipboard'

class ClipboardSharing {
  on = $state(storedText(KEY) !== 'no')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'yes' : 'no')
  }
}

export const clipboardSharing = new ClipboardSharing()
