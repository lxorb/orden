import { busy } from '../../ui-kit/src/api'
import { folderOf, relativeTo, invoke, joinPath, safeName, withinSpace } from '../../platform/src/api'
import { readShortcut } from '@orden/scan/shortcut'
import { type Space, workspace } from '../../workspace/src/api'
import { applyImport } from './apply'
import { nameKey } from './names'
import type { Planned } from './plan'
import type { SpacePlan } from './sidebar-plan'

export async function landSpaces(spaces: readonly SpacePlan[], lost: readonly string[], none: string): Promise<Space> {
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
  const held = workspace.spaces.find((one) => nameKey(safeName(one.name) ?? '') === nameKey(safeName(plan.name) ?? ''))
  const { canWriteAt } = await import('../../sharing/src/api')
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

async function unseen(root: string, files: readonly Planned[]): Promise<Planned[]> {
  const there = await Promise.all(
    files.map((file) => invoke<string>('read_note', { path: joinPath(root, file.path) }).catch(() => null)),
  )
  const beside = await pagesBeside(root, files)

  return files.filter((file, at) => {
    if (file.kind !== 'note') return true
    const mine = readShortcut(file.text)
    const pages = beside.get(nameKey(folderOf(file.path)))
    if (mine && pages && (pages.has(mine.url) || (mine.home && pages.has(mine.home)))) return false

    const held = there[at]
    if (held === null || held === undefined) return true
    if (!file.text) return false

    const theirs = readShortcut(held)
    if (!theirs || !mine) return true
    const kept = new Set([theirs.url, theirs.home].filter(Boolean))
    return !kept.has(mine.url) && !(mine.home && kept.has(mine.home))
  })
}

async function pagesBeside(root: string, files: readonly Planned[]): Promise<Map<string, Set<string>>> {
  const folders = new Set(files.filter((file) => SHORTCUT.test(file.path)).map((file) => nameKey(folderOf(file.path))))
  const held = workspace.files
    .map((entry) => withinSpace(root, entry.path))
    .filter((path): path is string => !!path && SHORTCUT.test(path))
    .filter((path) => folders.has(nameKey(folderOf(path))))
  const read = await Promise.all(
    held.map((path) => invoke<string>('read_note', { path: joinPath(root, path) }).catch(() => null)),
  )

  const pages = new Map<string, Set<string>>()
  held.forEach((path, at) => {
    const shortcut = readShortcut(read[at])
    if (!shortcut) return
    const folder = nameKey(folderOf(path))
    const seen = pages.get(folder) ?? new Set<string>()
    for (const page of [shortcut.url, shortcut.home]) if (page) seen.add(page)
    pages.set(folder, seen)
  })
  return pages
}

const SHORTCUT = /\.url$/i
