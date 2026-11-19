import { account } from '../../accounts/src/api'
import { iconChoice } from '../../icon-picker/src/api'
import { DIVIDER, held, latched, type MenuEntry, partView, trim, prompt } from '../../ui-kit/src/api'
import {
  canPublish,
  canShare,
  canTrustAgain,
  canWriteAt,
  isShared,
  managesSpace,
  roleOf,
  share,
  trustAgain,
  protectEntries,
} from '../../sharing/src/api'
import {
  hearSidebarParts,
  portOf,
  registerSettingsPart,
  type SettingPlace,
  settingsWindow,
  sidebarPart,
} from '@orden/contracts'
import { createSubscriber } from 'svelte/reactivity'
import { type Space, spaceChanges, workspace } from '../../workspace/src/api'
import { writeFile } from '../../file-writes/src/api'
import { AGENTS_NAME, joinPath, samePath } from '../../platform/src/api'

export const spaceArchiving = () => import('./space-archive')
export function settingsSpace(asked: string | null): Space | null {
  const root = asked ?? workspace.activeSpace?.root ?? null
  return root === null ? null : (workspace.spaces.find((one) => samePath(one.root, root)) ?? null)
}
const generalPlaces = (): readonly SettingPlace[] => [
  { label: 'Name', text: ['Rename', 'Space name'] },
  { label: 'Icon', text: ['Choose an icon', 'Space icon'] },
]
registerSettingsPart({
  section: 'space',
  title: 'General',
  card: true,
  order: 0,
  shown: () => settingsSpace(settingsWindow().space) !== null,
  places: generalPlaces,
  load: async () => partView((await import('./SpaceGeneral.svelte')).default, () => ({})),
})
registerSettingsPart({
  section: 'archived',
  card: false,
  shown: () => true,
  places: () => [{ label: 'Unarchive', text: ['Archive', 'Delete space'] }],
  load: async () => partView((await import('./ArchivedSpaces.svelte')).default, () => ({})),
})
export async function newSpace(): Promise<Space | undefined> {
  const name = await prompt.ask({
    title: 'Name the space',
    placeholder: 'Journal',
    confirmLabel: 'Create',
  })
  return name ? madeSpace(name) : undefined
}
export async function madeSpace(name: string, made?: (space: Space) => void): Promise<Space | undefined> {
  const space = await workspace.addSpace(name)
  if (!space) return
  made?.(space)
  if (!__EVEN_PLUGIN__) {
    const { AGENTS_SEED } = await import('../../agents-seed/src/api')
    await writeFile(joinPath(space.root, AGENTS_NAME), AGENTS_SEED).catch(() => undefined)
    await workspace.loadTree()
  }
  const { sync } = await import('../../sync-store/src/api')
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
  const { sync } = await import('../../sync-store/src/api')
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
    ...(managesSpace(space.root) ? [{ label: 'Rename', run: () => void renameSpace(space) }] : []),
    ...(canWriteAt(space.root) ? [{ label: 'Choose an icon', run: () => iconChoice.space(space.id) }] : []),
    ...(__EVEN_PLUGIN__ ? [] : [{ label: 'Settings', run: () => settingsWindow().show('space', space.root) }]),
    ...(canShare(space) ? [{ label: 'Share', run: () => void shareSpace(space) }] : []),
    ...(canPublish(space) ? [{ label: 'Publish', run: () => publishSpace(space) }] : []),
    ...(!__EVEN_PLUGIN__ && canTrustAgain(space)
      ? [{ label: 'Trust this space again', run: () => void trustAgain(space) }]
      : []),
    ...(!__EVEN_PLUGIN__ && (theirs || isShared(space.root))
      ? [
          {
            label: 'Nickname',
            run: () => void import('../../accounts-ui/src/api').then((one) => one.nameHere(space)),
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
            run: () => void spaceArchiving().then((one) => one.archiveSpace(space)),
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
  const publishing = portOf('publishing')
  if (publishing.ok) await publishing.value.show(space)
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
  const { mayEndSpace } = await spaceChanges()
  if (!(await mayEndSpace(workspace, space.id))) return
  const root = space.root
  await workspace.deleteSpace(space.id)
  const open = workspace.activeSpace
  if (open && workspace.archivedSpaces.has(open.root)) await (await spaceArchiving()).unarchiveSpace(open)
  const { sync } = await import('../../sync-store/src/api')
  await sync.forget(root, role)
}
export { default as SpaceBadge } from './SpaceBadge.svelte'
export const spaceSound = latched(() => import('./SpaceSound.svelte'))
export const soundMark = held(() => import('./SoundMark.svelte'))
export const loadSpaceMenu = () => import('./SpaceMenu.svelte')
export const loadSpacePicker = () => import('./SpacePicker.svelte')
export function toggleSpacePicker(): void {
  void import('./space-picker.svelte').then(({ spacePicker }) => spacePicker.toggle())
}
const heard = createSubscriber((update) => hearSidebarParts(update))
export function chatsUnreadIn(root: string): number {
  heard()
  return sidebarPart('chats')?.unreadIn?.(root) ?? 0
}
export function chatsUnreadBesides(spaces: readonly { root: string }[], here: string): number {
  return spaces.reduce((sum, one) => (one.root === here ? sum : sum + chatsUnreadIn(one.root)), 0)
}
