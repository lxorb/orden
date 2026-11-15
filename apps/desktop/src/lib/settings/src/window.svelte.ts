import type { SettingsSectionId } from '@orden/contracts'
import { connectors } from '../../connectors.svelte'
import { workspace } from '../../workspace/src/api'

class SettingsWindow {
  section = $state<SettingsSectionId>('general')
  listing = $state(true)
  historyOpen = $state(false)
  error = $state<string | null>(null)
  at = $state<'access' | null>(null)
  space = $state<string | null>(null)
  landsOnField = $state(false)
  asked = $state(0)

  get open(): boolean {
    return workspace.settingsShown
  }

  set open(on: boolean) {
    if (on) workspace.openSettings()
    else workspace.closeSettings()
  }

  show(section?: SettingsSectionId, space: string | null = null, landsOnField = false) {
    if (!landsOnField) this.asked++
    if (section === undefined && space === null && workspace.settingsTab !== null) {
      workspace.openSettings()
      return
    }
    this.space = space
    this.landsOnField = landsOnField
    const moved = section === 'agents' || section === 'llm'
    this.at = moved ? 'access' : null
    this.section = moved ? 'ai' : (section ?? 'general')
    this.listing = section === undefined
    this.error = null
    connectors.freshToken = null
    workspace.openSettings()
  }
}

export const settings = new SettingsWindow()
