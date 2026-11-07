import { t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { prompt } from '../prompt.svelte'
import { canWriteAt } from '../sharing.svelte'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { noteText } from '../workspace/note-text'
import { rewriteNotes } from './act'
import type { Kit } from './kit'
import { offersPlaces, placeEntries } from './project-actions'
import {
  cutSection,
  duplicatedSection,
  movedSection,
  placedSection,
  renamedSection,
  withBlock,
  withSection,
} from './sections'

export function projectOf(kit: Kit): { path: string; relative: string; name: string } | null {
  const spec = kit.spec
  if (spec.builtin !== 'project' || spec.path === undefined) return null
  const space = workspace.spaces.find((one) => one.name === spec.space)
  if (!space) return null
  const name = spec.path.replace(/^.*\//, '').replace(/\.md$/i, '')
  return { path: insideSpace(space.root, spec.path), relative: spec.path, name }
}

export function sectionsHere(path: string): readonly string[] {
  return links.held().find((one) => samePath(one.path, path))?.headings ?? []
}

export function addSection(kit: Kit, name: string, after: string | null = null): void {
  const project = projectOf(kit)
  if (!project) return
  void rewriteNotes([
    { path: project.path, after: (text) => withSection(text, name, after, project.name) },
  ])
}

export function placeSection(kit: Kit, name: string, target: string, after: boolean): void {
  const project = projectOf(kit)
  if (!project) return
  void rewriteNotes(
    [{ path: project.path, after: (text) => placedSection(text, name, target, after) }],
    'moved',
  )
}

export function renameSection(kit: Kit, from: string, to: string): void {
  const project = projectOf(kit)
  if (!project) return
  void rewriteNotes([{ path: project.path, after: (text) => renamedSection(text, from, to) }])
}

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
    ...(offersPlaces(workspace.rootHolding(path))
      ? [
          {
            label: t('Move to'),
            run: () => undefined,
            more: () =>
              Promise.resolve(
                placeEntries(
                  (target) => void moveSection(path, name, target),
                  (note) => samePath(note, path),
                  workspace.rootHolding(path),
                ),
              ),
          },
        ]
      : []),
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

async function moveSection(from: string, name: string, to: string): Promise<boolean> {
  if (samePath(from, to) || !canWriteAt(from) || !canWriteAt(to)) return false
  if ((await noteText(workspace, to)) === null) return false
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
    true,
  )
}

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
