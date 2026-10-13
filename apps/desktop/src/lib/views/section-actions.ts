/** What a project's section offers, from its head in the list or its column on the board:
 *  named again, a section added under it, moved up or down, duplicated, taken to another
 *  project or the Inbox, deleted with its tasks (asked first). Each is one write of the
 *  project's note, or of the two notes a move touches, so one undo (sections.ts). */

import { t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { prompt } from '../prompt.svelte'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { noteText } from '../workspace/note-text'
import { rewriteNotes } from './act'
import type { Kit } from './kit'
import { placeEntries } from './project-actions'
import {
  cutSection,
  duplicatedSection,
  movedSection,
  placedSection,
  renamedSection,
  withBlock,
  withSection,
} from './sections'

/** The project a view is of: its note on this disk and its name, or null for a view of
 *  something else. */
export function projectOf(kit: Kit): { path: string; relative: string; name: string } | null {
  const spec = kit.spec
  if (spec.builtin !== 'project' || spec.path === undefined) return null
  const space = workspace.spaces.find((one) => one.name === spec.space)
  if (!space) return null
  const name = spec.path.replace(/^.*\//, '').replace(/\.md$/i, '')
  return { path: insideSpace(space.root, spec.path), relative: spec.path, name }
}

/** The headings of a project's note (by its path in the space), as the link index read
 *  them: every section, empty ones too. Of the open space's notes only, which is where
 *  projects are added. */
export function sectionsHere(path: string): readonly string[] {
  return links.held().find((one) => samePath(one.path, path))?.headings ?? []
}

/** A new section at the end of the project, or under the one named. */
export function addSection(kit: Kit, name: string, after: string | null = null): void {
  const project = projectOf(kit)
  if (!project) return
  void rewriteNotes([
    { path: project.path, after: (text) => withSection(text, name, after, project.name) },
  ])
}

/** A section carried to just before or after another: a board's column dropped. */
export function placeSection(kit: Kit, name: string, target: string, after: boolean): void {
  const project = projectOf(kit)
  if (!project) return
  void rewriteNotes(
    [{ path: project.path, after: (text) => placedSection(text, name, target, after) }],
    'moved',
  )
}

/** A section named again. */
export function renameSection(kit: Kit, from: string, to: string): void {
  const project = projectOf(kit)
  if (!project) return
  void rewriteNotes([{ path: project.path, after: (text) => renamedSection(text, from, to) }])
}

/** A section's menu, from its ⋯ or a press with the other button. `rename` puts the
 *  head's own field up; `count` is how many tasks it holds, for the question a delete
 *  asks. */
export function sectionMenu(
  event: MouseEvent,
  kit: Kit,
  name: string,
  count: number,
  rename: () => void,
  extra: MenuEntry[] = [],
): void {
  const project = projectOf(kit)
  if (!project) return
  const path = project.path
  const write = (after: (text: string) => string | null, said?: 'moved' | 'deleted') =>
    void rewriteNotes([{ path, after }], said)

  const items: MenuEntry[] = [
    { label: t('Rename'), run: rename },
    {
      label: t('Add section'),
      asks: true,
      run: () =>
        void prompt
          .ask({ title: t('Add section'), confirmLabel: t('Add') })
          .then((words) => (words ? addSection(kit, words, name) : undefined)),
    },
    DIVIDER,
    { label: t('Move up'), run: () => write((text) => movedSection(text, name, true)) },
    { label: t('Move down'), run: () => write((text) => movedSection(text, name, false)) },
    {
      label: t('Duplicate'),
      run: () => write((text) => duplicatedSection(text, name, t('{name} (copy)', { name }))),
    },
    {
      label: t('Move to'),
      run: () => undefined,
      more: () =>
        Promise.resolve(
          placeEntries(
            (target) => void moveSection(path, name, target),
            (note) => samePath(note, path),
          ),
        ),
    },
    ...extra,
    DIVIDER,
    {
      label: t('Delete'),
      danger: true,
      asks: count > 0,
      run: () => void deleteSection(path, name, count),
    },
  ]
  menu.show(event, items, { title: name })
}

/** A section and its tasks taken to the end of another note, both written as one. */
async function moveSection(from: string, name: string, to: string): Promise<boolean> {
  // Read first: a note that will not read would take the section and keep nothing.
  if (samePath(from, to) || (await noteText(workspace, to)) === null) return false
  let block: string[] | null = null
  return rewriteNotes(
    [
      {
        path: from,
        after: (text) => {
          const cut = cutSection(text, name)
          block = cut?.block ?? null
          return cut?.rest ?? null
        },
      },
      { path: to, after: (text) => (block ? withBlock(text, block) : null) },
    ],
    'moved',
  )
}

/** A section deleted with what it holds; asked first where it holds tasks. */
async function deleteSection(path: string, name: string, count: number): Promise<void> {
  if (count > 0) {
    const sure = await prompt.confirm({
      title: t('Delete {name}?', { name }),
      detail: t('Its tasks are deleted with it.'),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!sure) return
  }
  await rewriteNotes([{ path, after: (text) => cutSection(text, name)?.rest ?? null }], 'deleted')
}
