/** A browser's spaces written into nib's: each into the space of its name, made where
 *  there is none, and an import that has been done before bringing only what is new.
 *  Every browser's, Zen's first; zen-landing.ts says why a space of the same name is
 *  the same space and what a second import brings. See sidebar-plan.ts for what
 *  becomes what. */

import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { relativeTo } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { readShortcut } from '../web-tab/shortcut'
import { type Space, workspace } from '../workspace.svelte'
import { applyImport } from './apply'
import { nameKey } from './names'
import type { Lost, Planned } from './plan'
import { worthKnowing } from './plan'
import type { SpacePlan } from './sidebar-plan'

/** The planned spaces, written one after the other, and what stayed behind said once
 *  they are. Answers the first of them, to land in; `none` is what is said when
 *  there is not one. */
export async function landSpaces(
  spaces: readonly SpacePlan[],
  lost: readonly Lost[],
  none: string,
): Promise<Space> {
  // One after the other: each is the open space while it is written.
  const landed: Space[] = []
  for (const plan of spaces) landed.push(await landSpace(plan))
  const [first] = landed
  if (!first) throw new Error(none)

  if (lost.length) busy.failed(lost.map(worthKnowing).join(' '))
  return first
}

async function landSpace(plan: SpacePlan): Promise<Space> {
  const held = workspace.spaces.find(
    (one) => nameKey(asFolder(one.name)) === nameKey(asFolder(plan.name)),
  )
  const space = held ?? (await workspace.addSpace(plan.name))
  if (!space) throw new Error(t('That import could not be written.'))
  // What follows is the open space's: the file list, its order, its bookmarks.
  if (workspace.activeSpaceId !== space.id) await workspace.selectSpace(space.id)

  const root = space.root
  const files = held ? await unseen(root, plan.files) : plan.files
  const landed = files.length ? await applyImport({ files }, { root, folder: '' }) : { paths: [] }
  // Where each file went, which is where it was planned unless a name was taken.
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

/** The longest name a space's folder takes, as the crate cuts it. */
const LONGEST_SPACE = 64

/** A space's name as the crate names its folder, which is the name the space then has
 *  (`folder_name` in spaces.rs): what a folder cannot be called a space, runs of space
 *  one, no dot or space at either end. A browser's space called `Work: Client` is the
 *  space `Work Client` the import made of it the time before. */
function asFolder(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
  const ends = /^[.\s]+|[.\s]+$/g
  return Array.from(cleaned.replace(ends, '')).slice(0, LONGEST_SPACE).join('').replace(ends, '')
}

/** The files the space does not already hold: a web note at the same place pointing
 *  at the same page, or an empty note where one already is, is left as it is. A file
 *  there that is something else stays too, and the import's steps aside from it. */
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
