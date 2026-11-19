import { account } from '../../accounts/src/api'
import { joining } from '../../sharing/src/api'
import { viewport, fullscreen } from '../../ui-kit/src/api'
import { workspace } from './workspace.svelte'

class Alone {
  on = $derived(
    !account.user &&
      (!!joining.invitation?.note || (!!account.guest && !account.spaces.length && !!workspace.active?.note.shared)),
  )

  pane = $derived(this.on ? workspace.panes.focusedId : null)
}

export const alone = new Alone()

export function swipeOpens(): boolean {
  return viewport.drawer && !fullscreen.on && !alone.on
}
