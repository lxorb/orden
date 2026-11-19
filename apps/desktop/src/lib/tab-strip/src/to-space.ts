import type { MenuEntry } from '../../ui-kit/src/api'
import { canWriteAt } from '../../sharing/src/api'
import type { Tab } from '../../documents/src/api'
import { mayCarry, movingOf, type Space, spaceMoving, spacesFor, workspace } from '../../workspace/src/api'

const tabsOf = (ids: readonly string[]) => workspace.tabs.filter((one) => ids.includes(one.id))

const spacesOfMoving = (moving: Parameters<typeof spacesFor>[0]): Space[] =>
  spacesFor(moving, workspace, canWriteAt, mayCarry).filter((one) => !workspace.archivedSpaces.has(one.root))

export const spacesOf = (tabs: readonly Tab[]) => spacesOfMoving(tabs.map(movingOf))

export const spacesOfPaths = (paths: readonly string[]) =>
  spacesOfMoving(paths.map((path) => ({ path, home: null, shared: null })))

export async function toSpace(ids: readonly string[], space: string): Promise<void> {
  const { moveToSpace } = await spaceMoving()
  await moveToSpace(ids, space)
}

export async function whichSpace(spaces: readonly Space[]): Promise<string | null> {
  const { prompt } = await import('../../ui-kit/src/api')
  return prompt.find({
    title: 'Move to space',
    options: spaces.map((one) => ({
      id: one.id,
      label: one.name,
      space: { id: one.id, name: one.name },
    })),
  })
}

export async function askSpace(ids: readonly string[]): Promise<void> {
  const space = await whichSpace(spacesOf(tabsOf(ids)))
  if (space) await toSpace(ids, space)
}

export function spaceEntry(tabs: readonly Tab[]): MenuEntry[] {
  const spaces = spacesOf(tabs)
  if (!spaces.length) return []

  const ids = tabs.map((one) => one.id)
  const move = (space: string) => void toSpace(ids, space)
  return [
    {
      label: 'Move to space',
      asks: true,
      run: () => void whichSpace(spaces).then((space) => space && move(space)),
      more: () => Promise.resolve(spaces.map((one) => ({ label: one.name, run: () => move(one.id) }))),
    },
  ]
}
