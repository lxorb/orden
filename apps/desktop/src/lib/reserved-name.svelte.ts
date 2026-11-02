/** A note called AGENTS refused, and the way to what the name is for.
 *
 *  The file of that name at the top of a space stays a file, for agents, CLIs and sync,
 *  and the app shows it as a field in the space's settings; see settings/SpacePane.svelte.
 *  So a note cannot take the name, anywhere in a space (`isAgentsName` in note-name.ts),
 *  and a refusal says where the words the name stands for are. A row says it in its own
 *  bubble (NameField.svelte); anything without a field to say it in says it here, in the
 *  toast Undo lives in, the way a failed board write does; see views/failed.svelte.ts. */

import { settings } from './settings.svelte'
import { landing } from './settings/landing.svelte'
import { undoToastNotice } from './surfaces.svelte'
import { UNDO_LINGER, undoToast } from './undo-toast.svelte'

/** The Space pane of the space at `root`, with the caret in its field. */
export function openInstructions(root: string) {
  landing.instructions = true
  settings.show('space', root)
}

class ReservedName {
  /** The space the toast is offering, while it says so. */
  root = $state.raw<string | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  tell(root: string) {
    if (!__EVEN_PLUGIN__) void undoToastNotice.ask()
    undoToast.dismiss()
    this.root = root
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  /** The toast's button. */
  open() {
    const root = this.root
    this.dismiss()
    if (root !== null) openInstructions(root)
  }

  dismiss() {
    this.root = null
    clearTimeout(this.timer)
  }
}

export const reservedName = new ReservedName()
