import type { OpenHow } from '@orden/contracts'
import { nameOf, samePath, shownName } from '../../platform/src/api'
import { basesOn } from '../../gates/src/api'
import { workspace } from '../../workspace/src/api'
import { builtinName, readViewSpec, sameView, type ViewSpec, writeViewSpec } from '../../tab-kinds/src/api'

function openAlready(spec: ViewSpec, path: string | null) {
  const paneId = workspace.panes.focusedId
  return workspace.tabs.find((tab) => {
    if (tab.kind !== 'view' || tab.paneId !== paneId) return false
    if (path !== null || tab.path !== null) return samePath(tab.path, path)
    const there = readViewSpec(tab.doc)
    return there !== null && sameView(there, spec)
  })
}
function openSpec(spec: ViewSpec, name: string, path: string | null = null, how: OpenHow = {}) {
  const there = openAlready(spec, path)
  if (there) {
    if (how.activate !== false) workspace.panes.activate(there.paneId, there.id)
    return there
  }
  return workspace.openView(writeViewSpec(spec), name, path, how)
}
export const openTodos = (how: OpenHow = {}) => openSpec({ builtin: 'todos' }, builtinName('todos'), null, how)
export function openBaseFile(path: string, how: OpenHow = {}, view?: string) {
  if (!basesOn()) return null
  const name = shownName(nameOf(path))
  return openSpec(view === undefined ? {} : { view }, name, path, how)
}
