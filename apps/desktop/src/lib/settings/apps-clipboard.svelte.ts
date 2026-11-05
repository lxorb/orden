/** Whether the clipboard goes between this device and an application it holds (issue
 *  1063, step 6; docs/apps.md): what this device copied, to the application's paste,
 *  and what the application copies, to this device. On out of the box, and a switch
 *  under Code in General while developer mode is on. Kept on this device through
 *  stored.ts. */

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
