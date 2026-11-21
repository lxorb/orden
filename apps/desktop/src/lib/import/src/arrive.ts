import { viewport } from '../../ui-kit/src/api'
import { firstVisiting, type Space, workspace } from '../../workspace/src/api'

export async function arrive(space: Space, open = true) {
  const { firstVisit } = await firstVisiting()
  if (firstVisit.fresh) firstVisit.answered()
  if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
  const note = open ? firstNote() : null
  if (note) await workspace.openEntry(note, { activate: true })
  if (!viewport.drawer) workspace.showPanel('tree')
}
const firstNote = (): string | null => (workspace.notes[0] ?? workspace.files[0])?.path ?? null
