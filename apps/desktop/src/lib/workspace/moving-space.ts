import { log, isAgentsName, nameOf, samePath } from '../platform/src/api'
import { canWriteAt } from '../sharing.svelte'
import { moveHistory } from '../terminal/history'
import { readSpec } from '../terminal/spec'
import type { Tab } from '../workspace.svelte'
import { workspace } from '../workspace.svelte'
import { mayCarry } from './chat-carry'
import type { Draft } from './session'
import { ownerOf } from './sets'
import { carried, movingOf, spacesFor } from './space-move'

export async function moveToSpace(ids: readonly string[], space: string): Promise<boolean> {
  const ws = workspace
  const target = ws.spaces.find((one) => one.id === space)
  if (!target) return false
  const tabs = ids.flatMap((id) => ws.tabs.find((one) => one.id === id) ?? [])
  const offered = spacesFor(tabs.map(movingOf), ws, canWriteAt, mayCarry)
  if (!offered.some((one) => one.id === space)) return false

  const moved: Tab[] = []
  const refused: string[] = []
  const files = new Map<string, boolean | 'said'>()
  for (const tab of tabs) {
    const how = carried(movingOf(tab), ws.spaces)
    if (how === 'file' && tab.path !== null && ownerOf(tab.path, null, ws.spaces) !== space) {
      const went = await fileMoved(tab.path, target.root, files)
      if (went !== true) {
        if (went === false) refused.push(tab.id)
        continue
      }
    } else if (how === 'home') {
      homed(tab, space)
    }
    const views = how === 'file' ? ws.tabs.filter((one) => one.note === tab.note) : [tab]
    moved.push(...views.filter((one) => !moved.includes(one)))
  }
  if (moved.length) {
    const { sets } = await import('./sets.svelte')
    await sets.adopt(moved, space)
  }
  if (refused.length) {
    const { failed } = await import('../views/failed.svelte')
    failed.tell(() => void moveToSpace(refused, space))
  }
  return tabs.every((tab) => moved.includes(tab))
}

export async function reopening(draft: Draft): Promise<Draft | null> {
  const ws = workspace
  const owner = ownerOf(draft.path, draft.space ?? null, ws.spaces)
  if (owner === null || owner === ws.activeSpaceId) return draft
  if (!ws.shownSpaces.some((one) => one.id === owner)) {
    if (draft.path === null) return { ...draft, space: ws.activeSpaceId ?? undefined }
    const { busy } = await import('../busy.svelte')
    busy.failed('Its space is archived')
    return null
  }
  if (draft.path !== null && !draft.dirty) {
    const { onDisk } = await import('../platform/src/api')
    if (!(await onDisk(draft.path))) return null
  }
  await ws.showSpace(owner)
  return draft
}

export function followsTo(path: string): void {
  const held = workspace.shownSpaces.some((one) => one.id === ownerOf(path, null, workspace.spaces))
  if (!held) throw new Error(`the space of ${path} is not here`)
}

export async function tabsFollow(path: string): Promise<void> {
  const ws = workspace
  const space = ownerOf(path, null, ws.spaces)
  if (space === null) return
  const { sets } = await import('./sets.svelte')
  await sets.adopt(
    ws.tabs.filter((tab) => tab.path !== null && samePath(tab.path, path)),
    space,
  )
}

async function fileMoved(path: string, root: string, done: Map<string, boolean | 'said'>) {
  const before = done.get(path)
  if (before !== undefined) return before

  if (isAgentsName(nameOf(path))) {
    void import('../reserved-name.svelte').then((one) => one.reservedName.tell(root))
    done.set(path, 'said')
    return 'said'
  }
  const ok = await workspace.move(path, root, 'carries').then(
    () => true,
    (error: unknown) => {
      log('warn', `${path} not moved into ${root} - ${String(error)}`)
      return false
    },
  )
  done.set(path, ok)
  return ok
}

function homed(tab: Tab, space: string) {
  if (tab.kind === 'terminal') {
    const key = readSpec(tab.doc)?.key ?? ''
    moveHistory({ space: tab.note.home, key }, { space, key })
  }
  tab.note.home = space
}
