/** An open project follows its note: renamed in the panel or the file list, moved into a
 *  folder, or its folder renamed, every tab showing it is about the note where it is
 *  now - its name, the note its tasks are read from, and how this device keeps its
 *  layout (kept-views.ts) - rather than an empty list about a note that is gone.
 *
 *  Loaded with the first view, and before any view a session brings back is drawn. */

import { builtinView, readBase, type View, writeBase } from '@nib/bases'
import { movedTo, relativeTo, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { keeping } from '../workspace/file-ops'
import { followProjectViews } from './kept-views'
import { readSpec, writeSpec } from './spec'

const nameOf = (path: string) => path.replace(/^.*\//, '').replace(/\.md$/i, '')

/** A project's view as its tab changed it, about the note at `to` instead of `from`:
 *  the filter and the name nib gave it follow, and whatever the reader changed stays. */
function followed(yaml: string, space: string, from: string, to: string): string {
  const was = builtinView('project', { note: { space, path: from } }).views[0]
  const now = builtinView('project', { note: { space, path: to } }).views[0]
  const base = readBase(yaml)
  const same = (one: View) => JSON.stringify(one.filters) === JSON.stringify(was?.filters)
  return writeBase({
    ...base,
    views: base.views.map((one) => ({
      ...one,
      ...(same(one) && now ? { filters: now.filters } : {}),
      ...(one.name === was?.name && now ? { name: now.name } : {}),
    })),
  })
}

workspace.fileOps.follow(
  keeping({
    moved(from, to, root) {
      const space = workspace.spaces.find((one) => root !== null && samePath(one.root, root))
      if (!space || root === null) return
      const was = relativeTo(root, from)
      const now = relativeTo(root, to)
      for (const tab of workspace.tabs) {
        if (tab.kind !== 'view' || tab.path !== null) continue
        const spec = readSpec(tab.doc)
        if (spec?.builtin !== 'project' || spec.space !== space.name || !spec.path) continue
        const path = movedTo(spec.path, was, now, root)
        if (path === null || path === spec.path) continue
        const yaml =
          spec.yaml === undefined ? {} : { yaml: followed(spec.yaml, space.name, spec.path, path) }
        tab.note.replace(writeSpec({ ...spec, path, ...yaml }), false)
        tab.note.name = nameOf(path)
      }
      followProjectViews(
        space.name,
        (path) => movedTo(path, was, now, root),
        (words, from, to) => followed(words, space.name, from, to),
      )
      workspace.scheduleSession()
    },
  }),
)
