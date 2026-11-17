import { workspace } from '../../workspace/src/api'
import { readSpec, writeSpec } from './spec'

export function setTerminalIcon(id: string, icon: string | null, colour: string | null): void {
  const tab = workspace.tabs.find((one) => one.id === id)
  const spec = tab?.kind === 'terminal' ? readSpec(tab.doc) : null
  if (!tab || !spec) return
  const plain = {
    shell: spec.shell,
    folder: spec.folder,
    key: spec.key,
    name: spec.name,
    ...(spec.via ? { via: spec.via } : {}),
  }
  const worn = icon === null ? plain : { ...plain, icon, ...(colour ? { iconColor: colour } : {}) }
  tab.note.replace(writeSpec(worn), false)
  workspace.scheduleSession()
}
