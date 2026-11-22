import { type Moment, startsFresh } from './fresh-start'
import { markSeedSpace, markSeeded, wasSeeded } from '../../seeded/src/api'
import { madeSpace } from '../../spaces/src/api'
import { beginSetup, gate } from './api'
import { joinPath } from '../../platform/src/api'
import { viewport } from '../../ui-kit/src/api'
import { WELCOME, WELCOME_NAME, WELCOME_SPACE } from '@orden/contracts'
import { writeFile } from '../../file-writes/src/api'
import { type Space, workspace } from '../../workspace/src/api'

class FirstSpace {
  private working = false
  async start(now: Moment) {
    if (this.working) return
    if (!startsFresh(now) || workspace.spaces.length) {
      if (!now.restoring) gate.letGo()
      return
    }
    this.working = true
    try {
      const space = await madeSpace(WELCOME_SPACE, (made) => markSeedSpace(made.root))
      if (!space) return
      const note = await this.welcome(space)
      await this.arrive(space, note)
      if (note) await beginSetup(false)
    } finally {
      this.working = false
      if (!gate.showing) gate.letGo()
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
    if (note) await workspace.openFirst(note)
    if (!viewport.drawer) workspace.showPanel('tree')
  }
}
export const firstSpace = new FirstSpace()
