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
