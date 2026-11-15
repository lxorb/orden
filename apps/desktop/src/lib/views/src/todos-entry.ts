import { readViewSpec } from '../../tab-kinds/src/api'
import { workspace } from '../../workspace/src/api'
import { openTodos } from './open'

export function showTodos(): void {
  const there = workspace.tabs.find(
    (tab) => tab.kind === 'view' && tab.path === null && readViewSpec(tab.doc)?.builtin === 'todos',
  )

  if (there) workspace.panes.activate(there.paneId, there.id)
  else openTodos()
}
