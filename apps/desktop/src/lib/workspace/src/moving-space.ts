import { log, isAgentsName, nameOf, samePath } from '../../platform/src/api'
import { canWriteAt } from '../../sharing/src/api'
import type { Tab } from '../../documents/src/api'
import { archivedRefused, workspace } from './workspace.svelte'
import { mayCarry } from './chat-carry'
import type { Draft } from '../../session/src/api'
import { ownerOf } from './sets'
import { carried, movingOf, spacesFor } from './space-move'
import { services } from './services'

export async function moveToSpace(ids: readonly string[], space: string): Promise<boolean | null> {
  const ws = workspace
  const target = ws.spaces.find((one) => one.id === space)
  if (!target) return false
  const tabs = ids.flatMap((id) => ws.tabs.find((one) => one.id === id) ?? [])
  const offered = spacesFor(
    tabs.map((tab) => ({ ...movingOf(tab), at: ws.spaceOfTab(tab) })),
    ws,
    canWriteAt,
    mayCarry,
  )
  if (!offered.some((one) => one.id === space)) return false
  const away = (tab: Tab) =>
    carried(movingOf(tab), ws.spaces) === 'file' && tab.path !== null && ownerOf(tab.path, null, ws.spaces) !== space
  const asked = tabs.filter(away)
  const onlyTabs = asked.length ? await tabsOnly(asked, target.name) : false
  if (onlyTabs === null) return null
  const moved: Tab[] = []
  const refused: string[] = []
  const files = new Map<string, boolean | 'said'>()
  for (const tab of tabs) {
    const how = carried(movingOf(tab), ws.spaces)
    if (onlyTabs && away(tab)) {
      moved.push(tab)
      continue
    }
    if (away(tab) && tab.path !== null) {
      const went = await fileMoved(tab.path, target.root, files)
      if (went !== true) {
        if (went === false) refused.push(tab.id)
        continue
      }
    } else if (how === 'home') {
      await homed(tab, space)
    }
    const views = how === 'file' ? ws.tabs.filter((one) => one.note === tab.note) : [tab]
    moved.push(...views.filter((one) => !moved.includes(one)))
  }
  if (moved.length) {
    const { sets } = await import('./sets.svelte')
    await sets.adopt(moved, space)
  }
  if (refused.length) {
    const { failed } = await import('./notices.svelte')
    failed.tell(() => void moveToSpace(refused, space))
  }
  return tabs.every((tab) => moved.includes(tab))
}
async function tabsOnly(tabs: readonly Tab[], to: string): Promise<boolean | null> {
  const ws = workspace
  const froms = [
    ...new Set(tabs.map((tab) => ws.spaces.find((one) => one.id === ownerOf(tab.path, null, ws.spaces))?.name)),
  ]
  const from = froms.length === 1 && froms[0] !== undefined ? froms[0] : null
  const [first] = tabs
  const one = tabs.length === 1 && first?.path ? nameOf(first.path) : null
  const { prompt } = await import('../../ui-kit/src/api')
  const answer = await prompt.choose({
    title: `Move ${one === null ? `${String(tabs.length)} tabs` : `"${one}"`}${from === null ? '' : ` from ${from}`} to ${to}?`,
    detail:
      one === null
        ? `Moving the files changes where they are saved. Only the tabs leave the files ${from === null ? 'where they are' : `in ${from}`}.`
        : `Moving the file changes where it is saved. Only the tab leaves the file ${from === null ? 'where it is' : `in ${from}`}.`,
    options: [
      { id: 'file', label: one === null ? 'Move the files too' : 'Move the file too', primary: true },
      { id: 'tab', label: one === null ? 'Only the tabs' : 'Only the tab' },
    ],
  })
  return answer === 'file' ? false : answer === 'tab' ? true : null
}
export async function reopening(draft: Draft): Promise<Draft | null> {
  const ws = workspace
  const owner = ownerOf(draft.path, draft.space ?? null, ws.spaces)
  if (owner === null || owner === ws.activeSpaceId) return draft
  if (!ws.shownSpaces.some((one) => one.id === owner)) {
    if (draft.path === null) return { ...draft, space: ws.activeSpaceId ?? undefined }
    archivedRefused()
    return null
  }
  if (draft.path !== null && !draft.dirty) {
    const { onDisk } = await import('../../platform/src/api')
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
    void import('./notices.svelte').then((one) => one.reservedName.tell(root))
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
async function homed(tab: Tab, space: string) {
  const from = tab.note.home
  tab.note.home = space
  if (tab.kind === 'terminal')
    await services()
      .terminalMoved(tab.doc, from, space)
      .catch(() => undefined)
}
