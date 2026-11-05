/** Todos, from wherever it is asked for: its key, the palette's row (#1047), and a
 *  double press on the right side's Todos icon (#1110). Every space's tasks in one view
 *  (#1046, #1153), as a tab like any other; the tab already showing it brought forward,
 *  in whichever pane it is in, rather than a second one opened beside it.
 *
 *  The views are fetched with the first ask, so the first paint carries none of them. */

import { workspace } from './workspace.svelte'

export async function showTodos(): Promise<void> {
  if (__EVEN_PLUGIN__) return
  const [{ openTodos }, { readSpec }] = await Promise.all([
    import('./views/open'),
    import('./views/spec'),
  ])

  const there = workspace.tabs.find(
    (tab) => tab.kind === 'view' && tab.path === null && readSpec(tab.doc)?.builtin === 'todos',
  )

  if (there) workspace.panes.activate(there.paneId, there.id)
  else openTodos()
}
