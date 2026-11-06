import { identifier } from '../identifier'
import { hostShell, writeSpec } from '../terminal/spec'
import { workspace } from '../workspace.svelte'
import { type Destination, hostFor } from './hosts'
import { remote } from './hosts.svelte'

const made = new Set<string>()

export function madeNow(key: string): boolean {
  return made.has(key)
}

export function markMade(key: string): void {
  made.add(key)
}

interface Where {
  beside?: string
}

export async function openRemote(id: string, where: Where = {}): Promise<void> {
  await remote.ready()
  const host = remote.byId(id)
  if (!host) return

  const key = identifier()
  made.add(key)
  remote.connected(id)
  const text = writeSpec({ shell: hostShell(id), folder: null, key, name: null })
  workspace.openUnsaved('terminal', text, host.name, where.beside ?? null)
}

export async function connectTo(wanted: Destination): Promise<void> {
  await remote.refresh()
  const host = hostFor(remote.hosts, wanted) ?? (await remote.make(wanted))
  if (host) await openRemote(host.id)
}
