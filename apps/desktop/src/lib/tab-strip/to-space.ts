import type { MenuEntry } from '../ui-kit/src/api'
import { canWriteAt } from '../sharing/src/api'
import { type Space, type Tab, workspace } from '../workspace.svelte'
import { mayCarry } from '../workspace/chat-carry'
import { movingOf, spacesFor } from '../workspace/space-move'

const tabsOf = (ids: readonly string[]) => workspace.tabs.filter((one) => ids.includes(one.id))

export function spacesOf(tabs: readonly Tab[]): Space[] {
  return spacesFor(tabs.map(movingOf), workspace, canWriteAt, mayCarry).filter(
    (one) => !workspace.archivedSpaces.has(one.root),
  )
}

export function spacesOfPaths(paths: readonly string[]): Space[] {
  const moving = paths.map((path) => ({ path, home: null, shared: null }))
  return spacesFor(moving, workspace, canWriteAt, mayCarry).filter(
    (one) => !workspace.archivedSpaces.has(one.root),
  )
}

export async function toSpace(ids: readonly string[], space: string): Promise<void> {
  const { moveToSpace } = await import('../workspace/moving-space')
  await moveToSpace(ids, space)
}

export async function whichSpace(spaces: readonly Space[]): Promise<string | null> {
  const { prompt } = await import('../ui-kit/src/api')
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
      more: () =>
        Promise.resolve(spaces.map((one) => ({ label: one.name, run: () => move(one.id) }))),
    },
  ]
}
