import type { SettingsSectionId } from '@orden/contracts'
import { connectors } from '../../accounts/src/api'
import { rootedAt } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'

class SettingsWindow {
  section = $state<SettingsSectionId>('general')
  listing = $state(true)
  historyOpen = $state(false)
  error = $state<string | null>(null)
  at = $state<'access' | null>(null)
  private held = $state<{ id: string } | { root: string } | null>(null)
  landsOnField = $state(false)
  asked = $state(0)
  get space(): string | null {
    const held = this.held
    if (held === null || 'root' in held) return held?.root ?? null
    return workspace.spaces.find((one) => one.id === held.id)?.root ?? null
  }
  set space(root: string | null) {
    const found = root === null ? undefined : rootedAt(workspace.spaces, root)
    this.held = root === null ? null : found ? { id: found.id } : { root }
  }
  get open(): boolean {
    return workspace.settingsShown
  }
  set open(on: boolean) {
    if (on) workspace.openSettings()
    else workspace.closeSettings()
  }
  show(section?: SettingsSectionId, space: string | null = null, landsOnField = false) {
    if (!landsOnField) this.asked++
    this.error = null
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
    connectors.freshToken = null
    workspace.openSettings()
  }
}
export const settings = new SettingsWindow()
