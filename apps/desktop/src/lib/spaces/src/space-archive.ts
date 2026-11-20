import { account, AccountOwed, type AccountSettings } from '../../accounts/src/api'
import { stored } from '../../platform/src/api'
import { type Space, workspace } from '../../workspace/src/api'

const OWED_KEY = 'orden:archived-spaces-owed'
let heard: readonly string[] | null = null
const owed = new AccountOwed(
  OWED_KEY,
  (settings) => {
    if (!Array.isArray(settings.archivedSpaces)) return
    heard = settings.archivedSpaces.filter((id): id is string => typeof id === 'string')
    void reconcile()
  },
  () => {
    heard = null
    for (const root of [...workspace.archivedSpaces.roots]) workspace.archivedSpaces.set(root, false)
  },
)
const owing = () => owed.standing || stored(OWED_KEY) === true
function canArchive(space: Space): boolean {
  const shown = workspace.shownSpaces
  return shown.length > 1 && shown.some((one) => one.id === space.id)
}
export async function archiveSpace(space: Space): Promise<void> {
  if (!canArchive(space)) return
  if (workspace.activeSpaceId === space.id) {
    const shown = workspace.shownSpaces
    const at = shown.findIndex((one) => one.id === space.id)
    const next = shown[at + 1] ?? shown[at - 1]
    if (next) await workspace.showSpace(next.id)
  }
  if (workspace.archivedSpaces.set(space.root, true)) await tell()
}
export async function unarchiveSpace(space: Space): Promise<void> {
  if (workspace.archivedSpaces.set(space.root, false)) await tell()
}
export function archivedSpaces(): Space[] {
  return workspace.spaces.filter((one) => workspace.archivedSpaces.has(one.root))
}
export async function receive(remote: AccountSettings): Promise<void> {
  owed.follows()
  if (!Array.isArray(remote.archivedSpaces)) return
  heard = remote.archivedSpaces.filter((id): id is string => typeof id === 'string')
  await listed()
}
export async function listed(): Promise<void> {
  if (stored(OWED_KEY) === true) await tell()
  else if (owed.standing) await settle()
  else await reconcile()
}
async function settle(): Promise<void> {
  const token = account.accountToken
  if (token) await owed.settle(token)
}
export async function reconcile(): Promise<void> {
  if (heard === null || owing()) return
  const { sync } = await import('../../sync-store/src/api')
  const said = new Set(heard)
  for (const space of workspace.spaces) {
    const id = sync.remoteIdFor(space.root)
    if (id === null) continue
    const away = said.has(id)
    if (away && workspace.shownSpaces.length < 2 && !workspace.archivedSpaces.has(space.root)) {
      continue
    }
    workspace.archivedSpaces.set(space.root, away)
  }
  await workspace.leaveArchived()
}
async function tell(): Promise<void> {
  const { sync } = await import('../../sync-store/src/api')
  const idOf = (space: Space) => sync.remoteIdFor(space.root)
  const known = new Set(workspace.spaces.map(idOf))
  const theirs = (heard ?? []).filter((id) => !known.has(id))
  const ids = [
    ...theirs,
    ...archivedSpaces()
      .map(idOf)
      .filter((id): id is string => id !== null),
  ]
  owed.send({ archivedSpaces: ids })
}
account.forgetWithSession(() => {
  heard = null
})
