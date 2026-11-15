import { askSheet } from '@orden/contracts'
import { openSpaces, type Space, workspace } from '../../workspace/src/api'
import { viewport } from '../../ui-kit/src/api'

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

    void askSheet('space-picker')
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
