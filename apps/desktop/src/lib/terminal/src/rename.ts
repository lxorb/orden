import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { isOnlineTab, MADE_NAME } from '../../online-terms/src/api'
import { folderOf, invoke } from '../../platform/src/api'
import { shellName, shells } from './shells.svelte'
import { hostIdOf, readSpec, writeSpec } from './spec'

const NAME_MOST = 120

export async function renameTerminal(tab: Tab, typed: string): Promise<void> {
  if (isOnlineTab(tab) && tab.path !== null) {
    const name = typed.trim().slice(0, NAME_MOST).replace(/[\\/]/g, ' ') || MADE_NAME
    const folder = folderOf(tab.path)
    await workspace.rename(tab.path, workspace.freeName(folder, `${name}.term`, tab.path))
    return
  }
  if (isOnlineTab(tab)) {
    tab.name = typed.trim().slice(0, NAME_MOST).replace(/[\\/]/g, ' ') || MADE_NAME
    workspace.scheduleSession()
    return
  }

  const before = readSpec(tab.doc)
  if (tab.kind !== 'terminal' || !before) return

  const name = typed.trim().slice(0, NAME_MOST) || null
  if (name === before.name) return
  const called = name ?? (await shellCalled(before.via ?? before.shell))

  const spec = readSpec(tab.doc) ?? before
  tab.name = called
  tab.note.replace(writeSpec({ ...spec, name }), false)
  workspace.scheduleSession()
  if (spec.key) void invoke('pty_name', { key: spec.key, name: name ?? '' }).catch(() => undefined)
}

async function shellCalled(id: string): Promise<string> {
  const host = hostIdOf(id)
  if (host !== null) {
    const { remote } = await import('./remote/hosts.svelte')
    await remote.ready()
    return remote.byId(host)?.name ?? host
  }

  const found = (await shells.ask()).find((one) => one.id === id)
  return found ? shellName(found) : id
}
