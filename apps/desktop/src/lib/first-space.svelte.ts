/** A fresh start: the first space, made without a question, open on the welcome note.
 *
 *  Emil, 2026-10-13, on the first screen that asked where somebody's notes come from:
 *  "rather welcome note instead". Bringing notes over from Obsidian or Notion is
 *  Settings > Import, and the welcome note's last line links there (welcome.ts).
 *
 *  What the browser build has always opened on, on every build: a space called what the
 *  browser's is, with the note in it, open, and the file list beside it where there is
 *  room - which is where Obsidian lands after creating a vault. When it happens is
 *  fresh-start.ts; the window asks for this only then, see App.svelte.
 *
 *  The welcome note goes in once per device, the rule the browser build keeps, so
 *  somebody who deleted it and later their last space is given a space again and not
 *  the note; an untouched welcome never travels to an account. See welcome.ts. */

import { markSeeded, wasSeeded } from './seeded'
import { madeSpace } from './space-actions'
import { joinPath } from './tauri'
import { viewport } from './viewport.svelte'
import { WELCOME, WELCOME_NAME, WELCOME_SPACE } from './welcome'
import { writeFile } from './workspace/write-file'
import { type Space, workspace } from './workspace.svelte'

class FirstSpace {
  /** Set while the space is being made, so a second ask in that moment does not make
   *  a second space. */
  private working = false

  async start() {
    if (this.working || workspace.spaces.length) return
    this.working = true
    try {
      const space = await madeSpace(WELCOME_SPACE)
      if (space) await this.arrive(space, await this.welcome(space))
    } finally {
      this.working = false
    }
  }

  /** The welcome note, into the space, once per device. Answers where it was written,
   *  or null. */
  private async welcome(space: Space): Promise<string | null> {
    if (await wasSeeded()) return null

    const path = joinPath(space.root, WELCOME_NAME)
    await writeFile(path, WELCOME)
    await markSeeded()
    await workspace.loadTree()
    return path
  }

  /** In the new space: the note open where there is one, and the file list beside it
   *  where there is room. On a phone the list is a drawer over the note, and opening
   *  it would hide the very note the space opened on. */
  private async arrive(space: Space, note: string | null) {
    if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
    if (note) await workspace.openEntry(note, { activate: true })
    if (!viewport.drawer) workspace.showPanel('tree')
  }
}

export const firstSpace = new FirstSpace()
