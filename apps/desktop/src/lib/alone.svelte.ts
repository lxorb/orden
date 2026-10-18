/** A guest's one shared file, with no chrome; see docs/sharing.md. */

import { account } from './account.svelte'
import { joining } from './joining.svelte'
import { workspace } from './workspace.svelte'

class Alone {
  on = $derived(
    !account.user &&
      (!!joining.invitation?.note ||
        (!!account.guest && !account.spaces.length && !!workspace.active?.note.shared)),
  )

  pane = $derived(this.on ? workspace.panes.focusedId : null)
}

export const alone = new Alone()
