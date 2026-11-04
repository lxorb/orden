/** Todos, from wherever it is asked for: the checkbox in the left side's top row, its
 *  key, and the palette's row (#1047). The space's one view of its tasks (#1046), as a
 *  tab like any other; the tab already showing it brought forward, in whichever pane it
 *  is in, rather than a second one opened beside it.
 *
 *  The views are fetched with the first ask, so the first paint carries none of them. */

import { workspace } from './workspace.svelte'

export async function showTodos(): Promise<void> {
  if (__EVEN_PLUGIN__) return
  const [{ openTodos }, { readSpec }] = await Promise.all([
    import('./views/open'),
    import('./views/spec'),
  ])

  const space = workspace.activeSpace?.name
  const there = workspace.tabs.find((tab) => {
    if (tab.kind !== 'view' || tab.path !== null) return false
    const spec = readSpec(tab.doc)
    return spec?.builtin === 'todos' && (spec.space ?? space) === space
  })

  if (there) workspace.panes.activate(there.paneId, there.id)
  else openTodos(space)
}
