import { agentMarks } from '../agent-marks.svelte'
import { keepJson, stored } from '../stored'
import { pages } from '../web-tab/pages.svelte'
import { type Tab, workspace } from '../workspace.svelte'
import { type HiddenTabs, isHiddenTabs, onLeaving } from './sets'

const STORAGE_KEY = 'orden:hidden-tabs'

function read(): HiddenTabs {
  const kept = stored(STORAGE_KEY)
  return isHiddenTabs(kept) ? kept : 'ask'
}

function running(tab: Tab): boolean {
  return tab.kind === 'web' && pages.of(tab.id).live && !(tab.id in agentMarks.on)
}

class Hidden {
  choice = $state<HiddenTabs>(read())

  private paused = new Set<string>()
  private asking: Promise<string | null> | null = null

  set(choice: HiddenTabs) {
    this.choice = choice
    keepJson(STORAGE_KEY, choice)

    if (choice === 'pause') {
      for (const tab of this.hidden()) this.pause(tab.id)
    } else {
      for (const id of [...this.paused]) this.resume(id)
    }
  }

  async left(tabs: readonly Tab[]): Promise<void> {
    const pausing = tabs.filter(running)
    const doing = onLeaving(this.choice, pausing.length)
    if (doing === 'run') return
    if (doing === 'ask' && (await this.ask()) !== 'pause') return

    for (const tab of pausing) if (!workspace.panes.at(tab.paneId)) this.pause(tab.id)
  }

  came(tabs: readonly Tab[]) {
    for (const tab of tabs) if (this.paused.has(tab.id)) this.resume(tab.id)
  }

  private ask(): Promise<string | null> {
    this.asking ??= import('../prompt.svelte')
      .then(({ prompt }) =>
        prompt.choose({
          title: 'Hidden tabs',
          options: [
            { id: 'run', label: 'Keep running', primary: true },
            { id: 'pause', label: 'Pause' },
          ],
        }),
      )
      .then((said) => {
        if (said === 'run' || said === 'pause') this.set(said)
        return said
      })
      .finally(() => (this.asking = null))

    return this.asking
  }

  private hidden(): Tab[] {
    return workspace.tabs.filter((tab) => running(tab) && !workspace.panes.at(tab.paneId))
  }

  private pause(tab: string) {
    this.paused.add(tab)
    pages.freeze(tab)
  }

  private resume(tab: string) {
    this.paused.delete(tab)
    void pages.thaw(tab)
  }
}

export const hiddenTabs = new Hidden()
