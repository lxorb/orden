import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { timeOn } from '../../gates/src/api'
import { type Spec, writeSpec } from './spec'

export function openTime(spec: Spec = { range: 'day', from: null, to: null, untracked: true, day: null }): Tab | null {
  if (!timeOn()) return null
  const open = workspace.singleHere('time')
  if (open) {
    workspace.activate(open.id)
    return open
  }
  return workspace.openUnsaved('time', writeSpec(spec), 'Time tracker')
}
