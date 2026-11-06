import { keep, storedText } from '../stored'

const KEY = 'nib:apps-clipboard'

class ClipboardSharing {
  on = $state(storedText(KEY) !== 'no')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'yes' : 'no')
  }
}

export const clipboardSharing = new ClipboardSharing()
