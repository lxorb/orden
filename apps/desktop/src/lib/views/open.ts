import type { OpenHow } from '../new-tab'
import { nameOf, samePath } from '../platform/src/api'
import { basesOn } from '../settings.svelte'
import { workspace } from '../workspace.svelte'
import { builtinName, readSpec, sameView, type ViewSpec, writeSpec } from './spec'

function openAlready(spec: ViewSpec, path: string | null) {
  const paneId = workspace.panes.focusedId
  return workspace.tabs.find((tab) => {
    if (tab.kind !== 'view' || tab.paneId !== paneId) return false
    if (path !== null || tab.path !== null) return samePath(tab.path, path)
    const there = readSpec(tab.doc)
    return there !== null && sameView(there, spec)
  })
}

function openSpec(spec: ViewSpec, name: string, path: string | null = null, how: OpenHow = {}) {
  const there = openAlready(spec, path)
  if (there) {
    if (how.activate !== false) workspace.panes.activate(there.paneId, there.id)
    return there
  }
  return workspace.openView(writeSpec(spec), name, path, how)
}

export function openTodos(how: OpenHow = {}) {
  return openSpec({ builtin: 'todos' }, builtinName('todos'), null, how)
}

export function openBaseFile(path: string, how: OpenHow = {}, view?: string) {
  if (!basesOn()) return null
  const name = nameOf(path).replace(/\.base$/i, '')
  return openSpec(view === undefined ? {} : { view }, name, path, how)
}
