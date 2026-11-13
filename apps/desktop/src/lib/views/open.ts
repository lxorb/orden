import type { OpenHow } from '../new-tab'
import { nameOf, samePath } from '../space-paths'
import { basesOn } from '../settings.svelte'
import { workspace } from '../workspace.svelte'
import { type Builtin, readSpec, sameView, type ViewSpec, writeSpec } from './spec'
import { builtinName } from './words'

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

export function openTodos(space?: string, how: OpenHow = {}) {
  return openSpec(
    space === undefined ? { builtin: 'todos' } : { builtin: 'todos', space },
    builtinName('todos'),
    null,
    how,
  )
}

/** @public */
export function openBuiltin(builtin: Builtin, how: OpenHow = {}) {
  return openSpec({ builtin }, builtinName(builtin), null, how)
}

export function openLabel(tag: string, how: OpenHow = {}, space?: string) {
  const spec: ViewSpec =
    space === undefined ? { builtin: 'label', tag } : { builtin: 'label', space, tag }
  return openSpec(spec, `#${tag}`, null, how)
}

export function openBaseFile(path: string, how: OpenHow = {}, view?: string) {
  if (!basesOn()) return null
  const name = nameOf(path).replace(/\.base$/i, '')
  return openSpec(view === undefined ? {} : { view }, name, path, how)
}
