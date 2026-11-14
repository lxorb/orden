import { busy } from '../busy.svelte'
import { relativeTo, invoke, joinPath } from '../platform/src/api'
import { readShortcut } from '@orden/scan/shortcut'
import { type Space, workspace } from '../workspace.svelte'
import { applyImport } from './apply'
import { nameKey } from './names'
import type { Planned } from './plan'
import type { SpacePlan } from './sidebar-plan'

export async function landSpaces(
  spaces: readonly SpacePlan[],
  lost: readonly string[],
  none: string,
): Promise<Space> {
  const landed: Space[] = []
  for (const plan of spaces) {
    const space = await landSpace(plan)
    if (space) landed.push(space)
  }
  const [first] = landed
  if (!first) throw new Error(none)

  if (lost.length) busy.failed(lost.join(' '))
  return first
}

async function landSpace(plan: SpacePlan): Promise<Space | null> {
  const held = workspace.spaces.find(
    (one) => nameKey(asFolder(one.name)) === nameKey(asFolder(plan.name)),
  )
  const { canWriteAt } = await import('../sharing.svelte')
  if (held && !canWriteAt(held.root)) return null
  const space = held ?? (await workspace.addSpace(plan.name))
  if (!space) throw new Error('That import could not be written.')
  if (workspace.activeSpaceId !== space.id) await workspace.selectSpace(space.id)

  const root = space.root
  const files = held ? await unseen(root, plan.files) : plan.files
  const landed = files.length ? await applyImport({ files }, { root, folder: '' }) : { paths: [] }
  const went = new Map(
    files.map((file, at) => {
      const path = landed.paths[at]
      return [file.path, path ? relativeTo(root, path) : file.path]
    }),
  )

  const at = (folder: string) => (folder ? joinPath(root, folder) : root)
  if (!held) {
    for (const [folder, names] of Object.entries(plan.order)) {
      const inside = (name: string) => (folder ? `${folder}/${name}` : name)
      const named = names.map((name) => went.get(inside(name))?.split('/').pop() ?? name)
      workspace.arranged.set(at(folder), named)
    }
    workspace.setSort('manual')
    if (plan.icon) workspace.setIcon(space.id, plan.icon, plan.tint)
  }

  for (const [folder, icon] of Object.entries(plan.folderIcons)) {
    if (!workspace.folderIcons.iconOf(at(folder))) workspace.setFolderIcon(at(folder), icon)
  }

  const marks = plan.bookmarks
    .map((path) => ({ kind: 'note' as const, path: went.get(path) ?? path, text: '' }))
    .filter((mark) => !workspace.bookmarks.has(mark))
  if (marks.length) workspace.bookmarks.toggleAll(marks)

  return space
}

const LONGEST_SPACE = 64

function asFolder(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
  const ends = /^[.\s]+|[.\s]+$/g
  return Array.from(cleaned.replace(ends, '')).slice(0, LONGEST_SPACE).join('').replace(ends, '')
}

async function unseen(root: string, files: readonly Planned[]): Promise<Planned[]> {
  const there = await Promise.all(
    files.map((file) =>
      invoke<string>('read_note', { path: joinPath(root, file.path) }).catch(() => null),
    ),
  )

  return files.filter((file, at) => {
    const held = there[at]
    if (held === null || held === undefined || file.kind !== 'note') return true
    if (!file.text) return false

    const theirs = readShortcut(held)
    const mine = readShortcut(file.text)
    if (!theirs || !mine) return true
    const pages = new Set([theirs.url, theirs.home].filter(Boolean))
    return !pages.has(mine.url) && !(mine.home && pages.has(mine.home))
  })
}
