import { account } from './accounts/src/api'
import { iconChoice } from './icon-choice.svelte'
import { DIVIDER, type MenuEntry, trim } from './menu.svelte'
import { prompt } from './ui-kit/src/api'
import {
  canPublish,
  canShare,
  canTrustAgain,
  canWriteAt,
  isShared,
  roleOf,
  share,
  trustAgain,
} from './sharing.svelte'
import { settings } from './settings.svelte'
import { type Space, workspace } from './workspace.svelte'
import { protectEntries } from './protect/entries'

const archiving = () => import('./space-archive')

export async function newSpace(): Promise<Space | undefined> {
  const name = await prompt.ask({
    title: 'Name the space',
    placeholder: 'Journal',
    confirmLabel: 'Create',
  })

  return name ? madeSpace(name) : undefined
}

export async function madeSpace(name: string): Promise<Space | undefined> {
  const space = await workspace.addSpace(name)
  if (!space) return
  if (!__EVEN_PLUGIN__) await (await import('./agents-seed')).seedAgents(space.root)

  const { sync } = await import('./sync.svelte')
  sync.nudge()
  return space
}

export function stepSpace(direction: number) {
  const spaces = workspace.shownSpaces
  if (spaces.length < 2) return

  const at = spaces.findIndex((one) => one.id === workspace.activeSpaceId)
  const next = spaces[(at < 0 ? 0 : at + direction + spaces.length) % spaces.length]
  if (next && next.id !== workspace.activeSpaceId) void workspace.showSpace(next.id)
}

async function moveSpace(id: string, beforeId: string | null) {
  if (!workspace.moveSpace(id, beforeId)) return

  const { sync } = await import('./sync.svelte')
  void sync.pushSpaceOrder()
}

function canNudge(space: Space, by: -1 | 1): boolean {
  if (roleOf(space.root) !== 'owner') return false

  const shown = workspace.shownSpaces
  const at = shown.findIndex((one) => one.id === space.id)
  const to = at + by
  return at >= 0 && to >= 0 && to < shown.length
}

async function nudgeSpace(space: Space, by: -1 | 1) {
  const shown = workspace.shownSpaces
  const at = shown.findIndex((one) => one.id === space.id)
  if (at < 0) return

  const to = at + by
  if (to < 0 || to >= shown.length) return

  const before = by === -1 ? shown[to] : shown[to + 1]
  await moveSpace(space.id, before?.id ?? null)
}

export function spaceMenu(space: Space): MenuEntry[] {
  const theirs = roleOf(space.root) !== 'owner'

  return trim([
    ...(theirs ? [] : [{ label: 'Rename', run: () => void renameSpace(space) }]),
    ...(canWriteAt(space.root)
      ? [{ label: 'Choose an icon', run: () => iconChoice.space(space.id) }]
      : []),
    ...(__EVEN_PLUGIN__
      ? []
      : [{ label: 'Settings', run: () => settings.show('space', space.root) }]),
    ...(canShare(space) ? [{ label: 'Share', run: () => void shareSpace(space) }] : []),
    ...(canPublish(space) ? [{ label: 'Publish', run: () => publishSpace(space) }] : []),
    ...(!__EVEN_PLUGIN__ && canTrustAgain(space)
      ? [{ label: 'Trust this space again', run: () => void trustAgain(space) }]
      : []),
    ...(!__EVEN_PLUGIN__ && (theirs || isShared(space.root))
      ? [
          {
            label: 'Nickname',
            run: () => void import('./accounts-ui/src/api').then((one) => one.nameHere(space)),
          },
        ]
      : []),
    ...protectEntries(space.root),
    DIVIDER,
    ...(canNudge(space, -1) ? [{ label: 'Move up', run: () => void nudgeSpace(space, -1) }] : []),
    ...(canNudge(space, 1) ? [{ label: 'Move down', run: () => void nudgeSpace(space, 1) }] : []),
    DIVIDER,
    ...(workspace.shownSpaces.length > 1 && !workspace.archivedSpaces.has(space.root)
      ? [
          {
            label: 'Archive',
            run: () => void archiving().then((one) => one.archiveSpace(space)),
          },
        ]
      : []),
    {
      label: theirs ? 'Leave space' : 'Delete space',
      danger: true,
      run: () => void deleteSpace(space),
    },
  ])
}

async function renameSpace(space: Space) {
  if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
  workspace.startRenaming(space.root)
}

export async function commitSpaceName(space: Space, name: string) {
  await workspace.renameSpace(space.id, name)
}

export async function shareSpace(space: Space) {
  await share.show(space)
}

export async function publishSpace(space: Space) {
  const { publish } = await import('./publishing.svelte')
  publish.show(space)
}

export async function deleteSpace(space: Space) {
  let role = roleOf(space.root)
  if (role === null) {
    await account.loadSpaces().catch(() => undefined)
    role = roleOf(space.root)
  }
  const theirs = role !== 'owner'

  const sure = await prompt.confirm({
    title: theirs ? `Leave ${space.name}?` : `Delete ${space.name}?`,
    detail: theirs
      ? 'It stays with everybody else. Its notes go from your computer.'
      : 'Every note in this space is deleted from your computer.',
    confirmLabel: theirs ? 'Leave' : 'Delete',
    danger: true,
  })

  if (!sure) return
  const { mayEndSpace } = await import('./workspace/space-changes')
  if (!(await mayEndSpace(workspace, space.id))) return

  const root = space.root
  await workspace.deleteSpace(space.id)

  const { sync } = await import('./sync.svelte')
  await sync.forget(root, role)
}
