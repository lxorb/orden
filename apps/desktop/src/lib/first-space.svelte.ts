import { type Moment, startsFresh } from './fresh-start'
import { markSeedSpace, markSeeded, wasSeeded } from './seeded'
import { settings } from './settings.svelte'
import { madeSpace } from './space-actions'
import { joinPath } from './tauri'
import { viewport } from './viewport.svelte'
import { WELCOME, WELCOME_NAME, WELCOME_SPACE } from './welcome'
import { writeFile } from './workspace/write-file'
import { type Space, workspace } from './workspace.svelte'

class FirstSpace {
  private working = false

  async start(now: Moment) {
    if (!startsFresh(now) || this.working || workspace.spaces.length) return
    this.working = true
    try {
      const space = await madeSpace(WELCOME_SPACE)
      if (!space) return
      markSeedSpace(space.root)
      const note = await this.welcome(space)
      await this.arrive(space, note)
      if (note) settings.setup = -1
    } finally {
      this.working = false
    }
  }

  private async welcome(space: Space): Promise<string | null> {
    if (await wasSeeded()) return null

    const path = joinPath(space.root, WELCOME_NAME)
    await writeFile(path, WELCOME)
    await markSeeded()
    await workspace.loadTree()
    return path
  }

  private async arrive(space: Space, note: string | null) {
    if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
    if (note) await workspace.openEntry(note, { activate: !workspace.tabs.length })
    if (!viewport.drawer) workspace.showPanel('tree')
  }
}

export const firstSpace = new FirstSpace()
