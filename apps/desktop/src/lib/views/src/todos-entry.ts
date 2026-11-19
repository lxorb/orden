import { readViewSpec } from '../../tab-kinds/src/api'
import { workspace } from '../../workspace/src/api'
import { openTodos } from './open'

export function showTodos(): void {
  const here = workspace.tabHere(
    (tab) => tab.kind === 'view' && tab.path === null && readViewSpec(tab.doc)?.builtin === 'todos',
  )
  if (here) workspace.activate(here.id)
  else openTodos()
}
