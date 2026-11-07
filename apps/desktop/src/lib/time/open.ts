import { t } from '../i18n.svelte'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { timeOn } from '../settings.svelte'
import { type Spec, writeSpec } from './spec'

export function openTime(spec: Spec = { view: 'day', day: null }): Tab | null {
  if (!timeOn()) return null
  const open = workspace.tabs.find((one) => one.kind === 'time')
  if (open) {
    if (spec.day !== null) open.note.replace(writeSpec(spec), false)
    workspace.activate(open.id)
    return open
  }
  return workspace.openUnsaved('time', writeSpec(spec), t('Time tracker'))
}
