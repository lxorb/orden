import { type Moment, startsFresh } from './fresh-start'
import { markSeedSpace, markSeeded, wasSeeded } from './seeded'
import { madeSpace } from './space-actions'
import { joinPath } from './platform/src/api'
import { viewport } from './ui-kit/src/api'
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
      if (note) await beginSetup()
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
    if (note) await workspace.openFirst(note)
    if (!viewport.drawer) workspace.showPanel('tree')
  }
}

async function beginSetup() {
  if (__EVEN_PLUGIN__) return
  const { setup } = await import('./onboarding/setup-state.svelte')
  setup.begin(false)
}

export const firstSpace = new FirstSpace()
