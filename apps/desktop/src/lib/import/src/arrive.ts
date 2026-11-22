import { viewport } from '../../ui-kit/src/api'
import { within } from '../../platform/src/api'
import { firstVisiting, type Space, workspace } from '../../workspace/src/api'

export async function arrive(space: Space, open = true) {
  const { firstVisit } = await firstVisiting()
  if (firstVisit.fresh) firstVisit.answered()
  if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
  const note = open ? firstNote(space.root) : null
  if (note) await workspace.openEntry(note, { activate: true })
  if (!viewport.drawer) workspace.showPanel('tree')
}
const WELCOME = /^(readme|home|index|start|start here|welcome)\.md$/i
function firstNote(root: string): string | null {
  const notes = workspace.notes.map((one) => ({ path: one.path, inside: within(root, one.path) ?? '' }))
  const top = notes.filter((one) => one.inside && !one.inside.includes('/') && !one.inside.startsWith('.'))
  const pick = top.find((one) => WELCOME.test(one.inside)) ?? top[0] ?? notes[0]
  return pick?.path ?? workspace.files[0]?.path ?? null
}
