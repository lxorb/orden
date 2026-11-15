import { readViewSpec } from './tab-kinds/src/api'
import { workspace } from './workspace.svelte'

export async function showTodos(): Promise<void> {
  if (__EVEN_PLUGIN__) return
  const { openTodos } = await (await import('./views/src/api')).baseOpening()

  const there = workspace.tabs.find(
    (tab) => tab.kind === 'view' && tab.path === null && readViewSpec(tab.doc)?.builtin === 'todos',
  )

  if (there) workspace.panes.activate(there.paneId, there.id)
  else openTodos()
}
