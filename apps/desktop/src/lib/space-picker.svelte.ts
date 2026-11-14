import { openSpaces } from './focus'
import { spacePickerDialog } from './surfaces.svelte'
import { viewport } from './ui-kit/src/api'
import { type Space, workspace } from './workspace.svelte'

class SpacePicker {
  open = $state(false)

  toggle(): void {
    if (viewport.touch) {
      openSpaces()
      return
    }
    if (this.open) {
      this.dismiss()
      return
    }

    void spacePickerDialog.ask()
    this.open = true
  }

  choose(space: Space): void {
    this.dismiss()
    if (space.id !== workspace.activeSpaceId) void workspace.showSpace(space.id)
  }

  dismiss(): void {
    this.open = false
  }
}

export const spacePicker = new SpacePicker()
