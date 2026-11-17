import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { timeOn } from '../../gates/src/api'
import { type Spec, writeSpec } from './spec'

export function openTime(spec: Spec = { view: 'day', day: null }): Tab | null {
  if (!timeOn()) return null
  const open = workspace.singleHere('time')
  if (open) {
    if (spec.day !== null) open.note.replace(writeSpec(spec), false)
    workspace.activate(open.id)
    return open
  }
  return workspace.openUnsaved('time', writeSpec(spec), 'Time tracker')
}
